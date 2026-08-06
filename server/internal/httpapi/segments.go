package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// routeSegments montiert die Segments-Endpunkte.
//
// Auth-Regeln (aus segments.php):
//   - GET  /api/segments  → öffentlich (customer_id via ?campaign_id=)
//   - POST /api/segments  → requireAuth (customer_admin oder super_admin)
//   - PUT  /api/segments  → requireAuth (bulk sort_order update)
//   - DELETE /api/segments → requireAuth
//
// Scope: campaign_id (Phase 1). Aufrufer nutzt campaignFromRequest().
func (s *Server) routeSegments(r chi.Router) {
	r.Get("/api/segments", s.handleGetSegments)

	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Post("/api/segments", s.handlePostSegment)
		pr.Put("/api/segments", s.handlePutSegments)
		pr.Delete("/api/segments", s.handleDeleteSegment)
	})
}

// segmentResponse ist die JSON-Repräsentation eines Segments für GET /api/segments.
// Das Feld Remaining ist *int, damit unlimited-Segmente null liefern (nicht 0).
type segmentResponse struct {
	ID               uint64  `json:"id"`
	Name             string  `json:"name"`
	Color            string  `json:"color"`
	WinText          string  `json:"win_text"`
	Weight           int     `json:"weight"`
	Image            string  `json:"image"`
	Theme            string  `json:"theme"`
	SortOrder        int     `json:"sort_order"`
	MaxCount         int     `json:"max_count"`
	Unlimited        bool    `json:"unlimited"`
	DepletedBehavior string  `json:"depleted_behavior"`
	IsRespin         bool    `json:"is_respin"`
	ImageOffsetX     float64 `json:"image_offset_x"`
	ImageOffsetY     float64 `json:"image_offset_y"`
	ImageRotation    float64 `json:"image_rotation"`
	ImageScale       float64 `json:"image_scale"`
	IsActive         bool    `json:"is_active"`
	Remaining        *int    `json:"remaining"` // null wenn unlimited
}

var colorRE = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// GET /api/segments?campaign_id=
//
// Öffentlicher Endpunkt: liefert aktive Segmente einer Kampagne mit dem
// verbleibenden Pool-Bestand je Segment (unlimited → remaining: null).
func (s *Server) handleGetSegments(w http.ResponseWriter, r *http.Request) {
	rawID := r.URL.Query().Get("campaign_id")
	if rawID == "" {
		writeJSON(w, http.StatusOK, []segmentResponse{})
		return
	}
	campaignID, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || campaignID == 0 {
		writeJSON(w, http.StatusOK, []segmentResponse{})
		return
	}

	var segs []models.Segment
	if err := s.DB.
		Where("campaign_id = ? AND is_active = TRUE", campaignID).
		Order("sort_order, id").
		Find(&segs).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler")
		return
	}

	remainingBy, err := pool.RemainingBySegment(s.DB, campaignID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Pool-Fehler")
		return
	}

	out := make([]segmentResponse, 0, len(segs))
	for _, seg := range segs {
		resp := segmentResponse{
			ID:               seg.ID,
			Name:             seg.Name,
			Color:            seg.Color,
			WinText:          seg.WinText,
			Weight:           seg.Weight,
			Image:            seg.Image,
			Theme:            seg.Theme,
			SortOrder:        seg.SortOrder,
			MaxCount:         seg.MaxCount,
			Unlimited:        seg.Unlimited,
			DepletedBehavior: seg.DepletedBehavior,
			IsRespin:         seg.IsRespin,
			ImageOffsetX:     seg.ImageOffsetX,
			ImageOffsetY:     seg.ImageOffsetY,
			ImageRotation:    seg.ImageRotation,
			ImageScale:       seg.ImageScale,
			IsActive:         seg.IsActive,
		}
		if seg.Unlimited {
			resp.Remaining = nil // JSON: null
		} else {
			rem := remainingBy[seg.ID] // 0 wenn nicht im Pool
			resp.Remaining = &rem
		}
		out = append(out, resp)
	}

	writeJSON(w, http.StatusOK, out)
}

// POST /api/segments  (create or update wenn ?id= vorhanden)
//
// Erwartet multipart/form-data (wegen optionalem Bild-Upload).
// Felder: name, win_text, weight, sort_order, max_count, theme, color,
//
//	unlimited, depleted_behavior, is_respin,
//	image_offset_x/y, image_rotation, image_scale,
//	segment_image (Datei, optional), existing_image (URL, optional).
func (s *Server) handlePostSegment(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// multipart: max 20 MB (Datei + Felder)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		// Wenn kein multipart, versuche URL-encoded
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, "Fehler beim Parsen der Anfrage")
			return
		}
	}

	// Helfer: FormValue mit Fallback
	fv := func(key string) string { return r.FormValue(key) }

	// --- Pflichtfeld ---
	name := strings.TrimSpace(fv("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name ist erforderlich")
		return
	}

	// --- Einfache Felder ---
	winText := fv("win_text")
	theme := fv("theme")
	if theme == "" {
		theme = "neutral"
	}

	weight := formInt(fv("weight"), 100)
	sortOrder := formInt(fv("sort_order"), 0)
	maxCount := formInt(fv("max_count"), 0)

	color := fv("color")
	if !colorRE.MatchString(color) {
		color = "#FF6B35"
	}

	unlimited := formBool(fv("unlimited"))
	if unlimited {
		maxCount = 0
	} else if maxCount < 1 {
		writeError(w, http.StatusBadRequest, "Anzahl in Kampagne muss mindestens 1 sein (oder als „unbegrenzt“ markieren).")
		return
	}

	depletedBehavior := fv("depleted_behavior")
	if depletedBehavior != "hide" && depletedBehavior != "grey" && depletedBehavior != "normal" {
		depletedBehavior = "hide"
	}

	isRespin := formBool(fv("is_respin"))

	imageOffsetX := clampFloat(formFloat(fv("image_offset_x"), 0), -5000, 5000)
	imageOffsetY := clampFloat(formFloat(fv("image_offset_y"), 0), -5000, 5000)
	imageRotation := clampFloat(formFloat(fv("image_rotation"), 0), -360, 360)
	imageScale := clampFloat(formFloat(fv("image_scale"), 1), 0.1, 5)

	// ?id= aus Query → Update; sonst Create
	segID := uint64(0)
	if rawSeg := r.URL.Query().Get("id"); rawSeg != "" {
		parsed, err := strconv.ParseUint(rawSeg, 10, 64)
		if err == nil {
			segID = parsed
		}
	}

	// Ownership-Prüfung beim Update
	var oldMaxCount int
	if segID != 0 {
		var existing models.Segment
		if err := s.DB.
			Where("campaign_id = ? AND id = ? AND is_active = TRUE", campaignID, segID).
			First(&existing).Error; err != nil {
			if isNotFound(err) {
				writeError(w, http.StatusNotFound, "Segment nicht gefunden")
				return
			}
			writeError(w, http.StatusInternalServerError, "Datenbankfehler")
			return
		}
		oldMaxCount = existing.MaxCount
	}

	// --- Bild-Upload / existing_image ---
	imagePath, uploadErr := resolveSegmentImage(r, campaignID)
	if uploadErr != nil {
		writeError(w, http.StatusBadRequest, uploadErr.Error())
		return
	}

	// --- Transaktion ---
	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		if segID != 0 {
			// UPDATE
			updates := map[string]any{
				"name":              name,
				"win_text":          winText,
				"weight":            weight,
				"sort_order":        sortOrder,
				"max_count":         maxCount,
				"theme":             theme,
				"color":             color,
				"unlimited":         unlimited,
				"depleted_behavior": depletedBehavior,
				"is_respin":         isRespin,
				"image_offset_x":    imageOffsetX,
				"image_offset_y":    imageOffsetY,
				"image_rotation":    imageRotation,
				"image_scale":       imageScale,
			}
			if imagePath != "" {
				updates["image"] = imagePath
			}
			if err := tx.Model(&models.Segment{}).
				Where("campaign_id = ? AND id = ?", campaignID, segID).
				Updates(updates).Error; err != nil {
				return err
			}
			// Pool anpassen, falls sich max_count geändert hat
			if oldMaxCount != maxCount {
				if err := pool.AdjustForSegment(tx, campaignID, segID, maxCount); err != nil {
					return err
				}
			}
		} else {
			// INSERT
			seg := models.Segment{
				CampaignID:       campaignID,
				Name:             name,
				WinText:          winText,
				Weight:           weight,
				Image:            imagePath,
				Theme:            theme,
				Color:            color,
				Unlimited:        unlimited,
				DepletedBehavior: depletedBehavior,
				IsRespin:         isRespin,
				SortOrder:        sortOrder,
				MaxCount:         maxCount,
				ImageOffsetX:     imageOffsetX,
				ImageOffsetY:     imageOffsetY,
				ImageRotation:    imageRotation,
				ImageScale:       imageScale,
				IsActive:         true,
			}
			if err := tx.Create(&seg).Error; err != nil {
				return err
			}
			segID = seg.ID
			// Pool-Einträge für das neue Segment anlegen
			if err := pool.AdjustForSegment(tx, campaignID, segID, maxCount); err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Speichern: "+txErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"id":      segID,
	})
}

// PUT /api/segments  (bulk sort_order update — Drag & Drop)
//
// Body: {"orders":[{"id":1,"sort_order":0},{"id":2,"sort_order":1},...]}
func (s *Server) handlePutSegments(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var body struct {
		Orders []struct {
			ID        uint64 `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"orders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Orders) == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige Daten")
		return
	}

	// Alle IDs auf Ownership prüfen (Segment muss zur Kampagne gehören)
	ids := make([]uint64, 0, len(body.Orders))
	for _, o := range body.Orders {
		if o.ID != 0 {
			ids = append(ids, o.ID)
		}
	}
	if len(ids) == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige Segment-IDs")
		return
	}
	var allowedCount int64
	if err := s.DB.Model(&models.Segment{}).
		Where("campaign_id = ? AND id IN ?", campaignID, ids).
		Count(&allowedCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler")
		return
	}
	if int(allowedCount) != len(ids) {
		writeError(w, http.StatusForbidden, "Ungültige Segment-IDs")
		return
	}

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		for _, o := range body.Orders {
			if err := tx.Model(&models.Segment{}).
				Where("campaign_id = ? AND id = ?", campaignID, o.ID).
				Update("sort_order", o.SortOrder).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Sortieren")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// DELETE /api/segments?id=  (soft delete: is_active=false + Pool leeren)
func (s *Server) handleDeleteSegment(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rawID := r.URL.Query().Get("id")
	if rawID == "" {
		writeError(w, http.StatusBadRequest, "ID erforderlich")
		return
	}
	segID, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || segID == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige ID")
		return
	}

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// Unbenutzte Pool-Einträge entfernen
		if err := pool.RemoveUnusedForSegment(tx, campaignID, segID); err != nil {
			return err
		}
		// Soft-Delete
		if err := tx.Model(&models.Segment{}).
			Where("campaign_id = ? AND id = ?", campaignID, segID).
			Update("is_active", false).Error; err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Löschen")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

// resolveSegmentImage verarbeitet existing_image und segment_image aus dem Request.
//
//   - Wenn segment_image hochgeladen wurde: Datei validieren, unter
//     server/uploads/campaign_<id>/segments/<rand>.<ext> speichern,
//     relative URL zurückgeben.
//   - Wenn existing_image gesetzt ist (und keine neue Datei kommt): Pfad
//     validieren und direkt übernehmen.
//   - Sonst: leerer String (Bild bleibt unverändert).
func resolveSegmentImage(r *http.Request, campaignID uint64) (string, error) {
	// Neue Datei hat Vorrang vor existing_image
	var file io.ReadCloser
	var origName string
	var contentType string

	if r.MultipartForm != nil {
		if fhs := r.MultipartForm.File["segment_image"]; len(fhs) > 0 {
			fh := fhs[0]
			f, err := fh.Open()
			if err != nil {
				return "", fmt.Errorf("Fehler beim Öffnen der hochgeladenen Datei")
			}
			file = f
			origName = fh.Filename
			contentType = fh.Header.Get("Content-Type")
		}
	}

	if file != nil {
		defer file.Close()

		// Content-Type-Validierung: muss image/* sein
		if !strings.HasPrefix(contentType, "image/") {
			return "", fmt.Errorf("Ungültiger Dateityp — nur Bilder erlaubt")
		}

		// Dateiendung aus Dateiname ableiten (Fallback: .bin)
		ext := filepath.Ext(origName)
		if ext == "" {
			ext = extensionFromMIME(contentType)
		}
		ext = strings.ToLower(ext)
		// Nur bekannte Bild-Extensions erlauben
		if !isAllowedImageExt(ext) {
			return "", fmt.Errorf("Ungültige Dateiendung: %s", ext)
		}

		// Zielverzeichnis anlegen
		uploadDir := filepath.Join("uploads", fmt.Sprintf("campaign_%d", campaignID), "segments")
		if err := os.MkdirAll(uploadDir, 0o755); err != nil {
			return "", fmt.Errorf("Verzeichnis konnte nicht erstellt werden")
		}

		// Zufälligen Dateinamen erzeugen
		randName, err := randomFileName(ext)
		if err != nil {
			return "", fmt.Errorf("Fehler beim Generieren des Dateinamens")
		}

		destPath := filepath.Join(uploadDir, randName)
		out, err := os.Create(destPath)
		if err != nil {
			return "", fmt.Errorf("Datei konnte nicht gespeichert werden")
		}
		defer out.Close()

		if _, err := io.Copy(out, file); err != nil {
			return "", fmt.Errorf("Fehler beim Schreiben der Datei")
		}

		// Relative URL (ohne führenden Slash), wie PHP's getCustomerUploadUrl
		return "uploads/campaign_" + strconv.FormatUint(campaignID, 10) + "/segments/" + randName, nil
	}

	// Kein neues Bild — existing_image übernehmen wenn vorhanden
	if existing := r.FormValue("existing_image"); existing != "" {
		if !isValidExistingImagePath(existing) {
			return "", fmt.Errorf("Ungültiger Bildpfad")
		}
		return existing, nil
	}

	return "", nil
}

// isValidExistingImagePath prüft, ob der Pfad das erwartete Muster hat und
// keine Path-Traversal-Versuche enthält.
func isValidExistingImagePath(p string) bool {
	// Muss mit "uploads/" beginnen und darf kein ".." enthalten
	if strings.Contains(p, "..") {
		return false
	}
	if !strings.HasPrefix(p, "uploads/") {
		return false
	}
	return true
}

// isAllowedImageExt gibt true zurück für gängige Bild-Extensions.
func isAllowedImageExt(ext string) bool {
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif":
		return true
	}
	return false
}

// extensionFromMIME leitet eine Dateiendung aus dem MIME-Typ ab.
func extensionFromMIME(mime string) string {
	switch {
	case strings.Contains(mime, "jpeg"):
		return ".jpg"
	case strings.Contains(mime, "png"):
		return ".png"
	case strings.Contains(mime, "gif"):
		return ".gif"
	case strings.Contains(mime, "webp"):
		return ".webp"
	case strings.Contains(mime, "svg"):
		return ".svg"
	case strings.Contains(mime, "avif"):
		return ".avif"
	default:
		return ".bin"
	}
}

// randomFileName erzeugt einen sicheren, zufälligen Dateinamen mit der
// übergebenen Extension. Verwendet crypto/rand über randomHex.
func randomFileName(ext string) (string, error) {
	h, err := randomHex(16)
	if err != nil {
		return "", err
	}
	return h + ext, nil
}

// isNotFound gibt true zurück wenn der GORM-Fehler ein "record not found" ist.
func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

// formInt parst einen Formular-String als int; bei Fehler wird def zurückgegeben.
func formInt(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return def
	}
	return v
}

// formFloat parst einen Formular-String als float64; bei Fehler wird def zurückgegeben.
func formFloat(s string, def float64) float64 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return def
	}
	return v
}

// formBool gibt true zurück für nicht-leere, nicht-"0"/nicht-"false" Strings.
func formBool(s string) bool {
	return s != "" && s != "0" && s != "false"
}

// clampFloat begrenzt v auf [min, max].
func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// randomHex erzeugt einen kryptographisch zufälligen Hex-String der Länge n*2.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
