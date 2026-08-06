package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"
	"gorm.io/gorm"
)

// routeCampaigns montiert die Campaigns-Endpunkte.
//
// Auth-Regeln: alle Endpunkte erfordern requireAuth (customer_admin oder super_admin).
//
// Routen (aus TASK4-PLAN.md §4):
//   - GET    /api/campaigns              → Liste der Kampagnen des Kunden
//   - POST   /api/campaigns              → Neue Kampagne (mode=empty|copy, source_id?); prüft campaign_limit
//   - PUT    /api/campaigns?id=          → Bearbeiten (name, on_empty, default_segment_id); ended→running blockiert
//   - DELETE /api/campaigns?id=          → Archivieren (soft)
//   - POST   /api/campaigns/clone?id=    → Klonen (auch von ended); ergibt neuen draft
//   - POST   /api/campaigns/start        → Kampagne auf Kiosk-Bildschirm starten (Phase 2: session_id)
//   - POST   /api/campaigns/end          → Kampagne beenden (terminale Aktion)
func (s *Server) routeCampaigns(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/campaigns", s.handleGetCampaigns)
		pr.Post("/api/campaigns", s.handlePostCampaign)
		pr.Put("/api/campaigns", s.handlePutCampaign)
		pr.Delete("/api/campaigns", s.handleDeleteCampaign)
		pr.Post("/api/campaigns/clone", s.handleCloneCampaign)
		pr.Post("/api/campaigns/start", s.handleStartCampaign)
		pr.Post("/api/campaigns/end", s.handleEndCampaign)
	})
}

// ─── Ownership helpers ────────────────────────────────────────────────────────

// customerIDForRequest gibt die maßgebliche customer_id für den Request zurück.
//
//   - customer_admin → immer user.CustomerID (kann nicht wechseln).
//   - super_admin    → optional ?customer_id= aus dem Query-String; fehlt der
//     Parameter, wird 0 zurückgegeben (kein Filter).
func customerIDForRequest(r *http.Request, user *models.User) (uint64, bool) {
	if user.Role != "super_admin" {
		if user.CustomerID == nil {
			return 0, false
		}
		return *user.CustomerID, true
	}
	// super_admin: optionaler Filter
	raw := r.URL.Query().Get("customer_id")
	if raw == "" {
		return 0, true // kein Filter
	}
	cid, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || cid == 0 {
		return 0, false
	}
	return cid, true
}

// campaignByID lädt eine Kampagne anhand der URL-Parameter ?id= und prüft
// die Ownership (customer_admin darf nur eigene Kampagnen anfassen).
func (s *Server) campaignByID(r *http.Request, user *models.User) (*models.Campaign, error) {
	rawID := r.URL.Query().Get("id")
	if rawID == "" {
		return nil, errors.New("id fehlt")
	}
	parsed, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || parsed == 0 {
		return nil, errors.New("ungültige id")
	}

	var camp models.Campaign
	if err := s.DB.First(&camp, parsed).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("kampagne nicht gefunden")
		}
		return nil, errors.New("datenbankfehler")
	}

	if user.Role != "super_admin" {
		if user.CustomerID == nil || camp.CustomerID != *user.CustomerID {
			return nil, errors.New("zugriff verweigert")
		}
	}
	return &camp, nil
}

// checkCampaignLimit prüft, ob customer_id noch eine weitere Kampagne anlegen darf.
// Rückgabe: (erlaubt, Fehler). Zählt ALLE Kampagnen (inkl. ended/archived) des Kunden.
func (s *Server) checkCampaignLimit(customerID uint64) (bool, error) {
	var customer models.Customer
	if err := s.DB.First(&customer, customerID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, errors.New("kunde nicht gefunden")
		}
		return false, errors.New("datenbankfehler")
	}

	var count int64
	if err := s.DB.Model(&models.Campaign{}).
		Where("customer_id = ?", customerID).
		Count(&count).Error; err != nil {
		return false, errors.New("datenbankfehler beim zählen der kampagnen")
	}

	return int(count) < customer.CampaignLimit, nil
}

// copyCampaign kopiert Segmente und Settings der Quell-Kampagne in eine neue
// (bereits gespeicherte) Ziel-Kampagne und generiert anschließend den Spin-Pool.
func (s *Server) copyCampaign(srcID, dstID uint64) error {
	// Segmente kopieren
	var srcSegments []models.Segment
	if err := s.DB.Where("campaign_id = ?", srcID).Find(&srcSegments).Error; err != nil {
		return errors.New("fehler beim laden der segmente")
	}
	for _, seg := range srcSegments {
		newSeg := seg
		newSeg.ID = 0 // Auto-Increment
		newSeg.CampaignID = dstID
		if err := s.DB.Create(&newSeg).Error; err != nil {
			return errors.New("fehler beim kopieren der segmente")
		}
	}

	// Settings kopieren
	var srcSettings []models.Setting
	if err := s.DB.Where("campaign_id = ?", srcID).Find(&srcSettings).Error; err != nil {
		return errors.New("fehler beim laden der settings")
	}
	for _, setting := range srcSettings {
		newSetting := setting
		newSetting.ID = 0
		newSetting.CampaignID = dstID
		if err := s.DB.Create(&newSetting).Error; err != nil {
			return errors.New("fehler beim kopieren der settings")
		}
	}

	// Spin-Pool für neue Kampagne generieren
	if _, err := pool.GenerateForCampaign(s.DB, dstID); err != nil {
		return errors.New("fehler beim generieren des spin-pools")
	}
	return nil
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// GET /api/campaigns
// Liste der Kampagnen des authentifizierten Kunden.
// super_admin kann optional ?customer_id= übergeben, um nach Kunde zu filtern.
func (s *Server) handleGetCampaigns(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	cid, ok := customerIDForRequest(r, user)
	if !ok {
		writeError(w, http.StatusBadRequest, "ungültige customer_id")
		return
	}

	query := s.DB.Model(&models.Campaign{})
	if cid != 0 {
		query = query.Where("customer_id = ?", cid)
	}
	// customer_admin hat immer eine feste customer_id (0 kann hier nicht auftreten
	// wegen der Logik in customerIDForRequest, aber zur Sicherheit absichern)
	if user.Role != "super_admin" && cid == 0 {
		writeError(w, http.StatusForbidden, "zugriff verweigert")
		return
	}

	var campaigns []models.Campaign
	if err := query.Order("created_at DESC").Find(&campaigns).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim laden der kampagnen")
		return
	}

	writeJSON(w, http.StatusOK, campaigns)
}

// POST /api/campaigns
// Body: {"name": "...", "mode": "empty"|"copy", "source_id": <uint64>?}
// Prüft campaign_limit vor dem Anlegen.
// mode=empty  → leere Kampagne (status=draft, keine Segmente)
// mode=copy   → kopiert Segmente + Settings der source_id, generiert Spin-Pool
func (s *Server) handlePostCampaign(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	// customer_id des handelnden Users ermitteln
	var customerID uint64
	if user.Role == "super_admin" {
		// super_admin muss customer_id explizit angeben
		raw := r.URL.Query().Get("customer_id")
		if raw == "" {
			writeError(w, http.StatusBadRequest, "super_admin benötigt ?customer_id=")
			return
		}
		cid, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || cid == 0 {
			writeError(w, http.StatusBadRequest, "ungültige customer_id")
			return
		}
		customerID = cid
	} else {
		if user.CustomerID == nil {
			writeError(w, http.StatusForbidden, "kein kunde zugewiesen")
			return
		}
		customerID = *user.CustomerID
	}

	// Request-Body parsen
	type postCampaignReq struct {
		Name     string  `json:"name"`
		Mode     string  `json:"mode"`
		SourceID *uint64 `json:"source_id"`
	}
	var req postCampaignReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "ungültige anfrage")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name erforderlich")
		return
	}
	if req.Mode != "empty" && req.Mode != "copy" {
		writeError(w, http.StatusBadRequest, "mode muss 'empty' oder 'copy' sein")
		return
	}
	if req.Mode == "copy" && req.SourceID == nil {
		writeError(w, http.StatusBadRequest, "source_id erforderlich für mode=copy")
		return
	}

	// Limit prüfen (alle Kampagnen des Kunden zählen, inkl. ended/archived)
	allowed, err := s.checkCampaignLimit(customerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "Kampagnen-Limit erreicht")
		return
	}

	// Quell-Kampagne validieren (mode=copy)
	if req.Mode == "copy" {
		var src models.Campaign
		if err := s.DB.First(&src, *req.SourceID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				writeError(w, http.StatusNotFound, "quell-kampagne nicht gefunden")
				return
			}
			writeError(w, http.StatusInternalServerError, "datenbankfehler")
			return
		}
		// Ownership: Quelle muss demselben Kunden gehören
		if src.CustomerID != customerID {
			writeError(w, http.StatusForbidden, "quell-kampagne gehört nicht zum kunden")
			return
		}
	}

	// Neue Kampagne anlegen (immer draft)
	newCamp := models.Campaign{
		CustomerID: customerID,
		Name:       req.Name,
		Status:     "draft",
	}
	if err := s.DB.Create(&newCamp).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim anlegen der kampagne")
		return
	}

	// Kopieren (mode=copy)
	if req.Mode == "copy" {
		if err := s.copyCampaign(*req.SourceID, newCamp.ID); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"id":      newCamp.ID,
	})
}

// PUT /api/campaigns?id=
// Editierbare Felder: name, on_empty, default_segment_id, estimated_spins, status.
// Blockiert den Übergang status ended → running (400).
func (s *Server) handlePutCampaign(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	camp, err := s.campaignByID(r, user)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "kampagne nicht gefunden" {
			status = http.StatusNotFound
		} else if err.Error() == "zugriff verweigert" {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}

	type putCampaignReq struct {
		Name             *string `json:"name"`
		OnEmpty          *string `json:"on_empty"`
		DefaultSegmentID *uint64 `json:"default_segment_id"`
		EstimatedSpins   *int    `json:"estimated_spins"`
		Status           *string `json:"status"`
	}
	var req putCampaignReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "ungültige anfrage")
		return
	}

	// Transition ended → running blockieren
	if req.Status != nil && *req.Status == "running" && camp.Status == "ended" {
		writeError(w, http.StatusBadRequest, "beendete Kampagne kann nicht wieder gestartet werden")
		return
	}

	// Updates zusammenstellen (nur gesetzte Felder)
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.OnEmpty != nil {
		updates["on_empty"] = *req.OnEmpty
	}
	if req.DefaultSegmentID != nil {
		updates["default_segment_id"] = *req.DefaultSegmentID
	}
	if req.EstimatedSpins != nil {
		updates["estimated_spins"] = *req.EstimatedSpins
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}

	if len(updates) == 0 {
		writeError(w, http.StatusBadRequest, "keine felder zum aktualisieren angegeben")
		return
	}

	if err := s.DB.Model(camp).Updates(updates).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim speichern")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// DELETE /api/campaigns?id=
// Soft-Delete: setzt status auf 'archived'.
func (s *Server) handleDeleteCampaign(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	camp, err := s.campaignByID(r, user)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "kampagne nicht gefunden" {
			status = http.StatusNotFound
		} else if err.Error() == "zugriff verweigert" {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}

	if err := s.DB.Model(camp).Update("status", "archived").Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim archivieren")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// POST /api/campaigns/clone?id=
// Klont eine Kampagne (auch ended/archived) → neuer draft.
// Kopiert Segmente + Settings, generiert Spin-Pool.
// Prüft campaign_limit wie POST /api/campaigns.
func (s *Server) handleCloneCampaign(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	src, err := s.campaignByID(r, user)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "kampagne nicht gefunden" {
			status = http.StatusNotFound
		} else if err.Error() == "zugriff verweigert" {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}

	// Limit prüfen
	allowed, err := s.checkCampaignLimit(src.CustomerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "Kampagnen-Limit erreicht")
		return
	}

	// Neue (leere) Kampagne anlegen
	newCamp := models.Campaign{
		CustomerID:     src.CustomerID,
		Name:           src.Name + " (Kopie)",
		Status:         "draft",
		OnEmpty:        src.OnEmpty,
		EstimatedSpins: src.EstimatedSpins,
	}
	// DefaultSegmentID wird NICHT übernommen: der neue Draft hat noch keine
	// eigenen Segmente; der Klient muss das Feld nach dem Klonen neu setzen.
	if err := s.DB.Create(&newCamp).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim anlegen der kampagne")
		return
	}

	// Segmente + Settings kopieren + Pool generieren
	if err := s.copyCampaign(src.ID, newCamp.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"id":      newCamp.ID,
	})
}

// POST /api/campaigns/start
// TODO Phase 2 (kiosk pairing) — verknüpft Kampagne mit kiosk_session
func (s *Server) handleStartCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 2 (kiosk pairing)")
}

// POST /api/campaigns/end
// TODO Phase 2 (kiosk pairing) — beendet Kampagne terminal + gibt Kiosk-Bildschirm frei
func (s *Server) handleEndCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 2 (kiosk pairing)")
}
