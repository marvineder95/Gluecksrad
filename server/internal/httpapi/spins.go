package httpapi

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// routeSpin montiert die Spin-Endpunkte.
//
// Auth-Regeln (aus spin.php):
//   - POST   /api/spin  → öffentlich (Kiosk dreht ohne Login; rate-limited)
//   - DELETE /api/spin  → requireAuth (Kampagne zurücksetzen, nur customer_admin/super_admin)
//
// Scope: campaign_id (Phase 1). Kiosk liefert campaign_id via device_token (Phase 2).
// Bis Phase 2: campaign_id aus ?campaign_id= Query-Parameter.
//
// Wichtig: POST /api/spin?test=1 ist ein Test-Dreh (wird nicht in DB gespeichert).
func (s *Server) routeSpin(r chi.Router) {
	r.Post("/api/spin", s.handlePostSpin)

	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Delete("/api/spin", s.handleDeleteSpin)
	})
}

// spinSegment ist die interne Arbeitsrepräsentation eines aktiven Segments
// während eines Dreh-Vorgangs (Port der $allSegments-Struktur aus spin.php).
type spinSegment struct {
	seg         models.Segment
	isUnlimited bool
	remaining   int  // nur relevant wenn !isUnlimited
	available   bool // unlimited ODER remaining > 0
	depleted    bool // !unlimited && remaining <= 0
}

// segmentJSON baut das winner-Objekt wie im PHP (Felder aus dem SELECT in spin.php:
// id, name, color, win_text, weight, image, theme, unlimited, depleted_behavior, is_respin
// plus abgeleitete Felder is_unlimited/remaining/available/depleted).
func segmentJSON(c *spinSegment) map[string]any {
	seg := c.seg
	var remaining any
	if c.isUnlimited {
		remaining = nil
	} else {
		remaining = c.remaining
	}
	return map[string]any{
		"id":                seg.ID,
		"name":              seg.Name,
		"color":             seg.Color,
		"win_text":          seg.WinText,
		"weight":            seg.Weight,
		"image":             seg.Image,
		"theme":             seg.Theme,
		"unlimited":         seg.Unlimited,
		"depleted_behavior": seg.DepletedBehavior,
		"is_respin":         seg.IsRespin,
		"is_unlimited":      c.isUnlimited,
		"remaining":         remaining,
		"available":         c.available,
		"depleted":          c.depleted,
	}
}

type spinRequestBody struct {
	LeadID uint64 `json:"lead_id"`
}

// POST /api/spin?campaign_id=  (öffentlich, rate-limited)
//
// Port der kompletten Dreh-Logik aus backend/api/spin.php.
func (s *Server) handlePostSpin(w http.ResponseWriter, r *http.Request) {
	isTest := r.URL.Query().Get("test") == "1"

	// Kampagne auflösen. TODO Phase 2: device_token → kiosk_sessions.campaign_id.
	// Bis dahin: campaign_id aus dem Query-Parameter (öffentlicher Endpunkt,
	// daher KEINE Owner-Prüfung wie im Dashboard — nur Existenz validieren).
	campaignID, err := publicCampaignID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var campaign models.Campaign
	if err := s.DB.First(&campaign, campaignID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusBadRequest, "Kampagne nicht gefunden")
			return
		}
		writeError(w, http.StatusInternalServerError, "Datenbankfehler")
		return
	}

	// Kampagnenstatus prüfen (PHP: settings.campaign_status; jetzt: campaign.status).
	if campaign.Status == "ended" {
		writeError(w, http.StatusBadRequest, "Kampagne ist beendet.")
		return
	}
	if campaign.Status == "paused" {
		writeError(w, http.StatusBadRequest, "Kampagne ist pausiert.")
		return
	}

	// Lead-ID aus dem Body lesen (optional). Body ist bei ?test=1 evtl. leer.
	var reqBody spinRequestBody
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&reqBody)
	}

	// Gesamte Dreh-Logik in einer Transaktion (wie PHP: beginTransaction()).
	var (
		respBody   map[string]any
		respStatus int
	)

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// Alle aktiven Segmente laden, ORDER BY sort_order, id (identisch zu segments.php GET).
		var allSegments []models.Segment
		if err := tx.Raw(`
			SELECT * FROM segments
			WHERE campaign_id = ? AND is_active = TRUE
			ORDER BY sort_order, id
		`, campaignID).Scan(&allSegments).Error; err != nil {
			return err
		}

		remainingBy, err := pool.RemainingBySegment(tx, campaignID)
		if err != nil {
			return err
		}

		// Arbeitsrepräsentation aufbauen (Port der foreach-Schleife in spin.php).
		segs := make([]*spinSegment, 0, len(allSegments))
		for _, seg := range allSegments {
			c := &spinSegment{seg: seg, isUnlimited: seg.Unlimited}
			if c.isUnlimited {
				c.remaining = 0
				c.available = true
				c.depleted = false
			} else {
				c.remaining = remainingBy[seg.ID]
				c.available = c.remaining > 0
				c.depleted = c.remaining <= 0
			}
			segs = append(segs, c)
		}

		// displaySegments = aktive minus (depleted && depleted_behavior == 'hide').
		// EXAKT die Liste + Reihenfolge, die das Frontend rendert.
		displaySegments := make([]*spinSegment, 0, len(segs))
		for _, c := range segs {
			if c.depleted && c.seg.DepletedBehavior == "hide" {
				continue
			}
			displaySegments = append(displaySegments, c)
		}

		// Gewinnbare Kandidaten = available.
		candidates := make([]*spinSegment, 0, len(segs))
		for _, c := range segs {
			if c.available {
				candidates = append(candidates, c)
			}
		}

		if len(candidates) == 0 || len(displaySegments) == 0 {
			// TODO Phase 3: on_empty == 'default' → Default-Segment ausspielen
			// statt die Kampagne zu beenden. Hier einhängen.
			// Kampagne beenden. Status außerhalb der (zurückgerollten) Transaktion setzen.
			respStatus = http.StatusBadRequest
			respBody = map[string]any{
				"error": "Kampagne abgeschlossen. Alle Gewinne wurden vergeben.",
				"code":  "campaign_ended",
			}
			// Rollback der Transaktion (kein Spin), Status wird danach persistiert.
			return errCampaignEnded
		}

		// Gewichtete Auswahl.
		// unlimited teilen sich dynamisch die "Restdrehungen":
		//   leftover = max(countUnlimited, estimatedSpins - limitedRemaining)
		//   unlimitedWeight = max(1, round(leftover / countUnlimited))
		estimatedSpins := campaign.EstimatedSpins
		if estimatedSpins < 1 {
			estimatedSpins = 1
		}

		limitedRemaining := 0
		countUnlimited := 0
		for _, c := range candidates {
			if c.isUnlimited {
				countUnlimited++
			} else {
				limitedRemaining += c.remaining
			}
		}
		leftover := estimatedSpins - limitedRemaining
		if countUnlimited > leftover {
			leftover = countUnlimited
		}
		unlimitedWeight := 0
		if countUnlimited > 0 {
			unlimitedWeight = int(math.Round(float64(leftover) / float64(countUnlimited)))
			if unlimitedWeight < 1 {
				unlimitedWeight = 1
			}
		}

		weightOf := func(c *spinSegment) int {
			if c.isUnlimited {
				return unlimitedWeight
			}
			return c.remaining
		}

		total := 0
		for _, c := range candidates {
			total += weightOf(c)
		}
		if total < 1 {
			total = 1
		}
		// mt_rand(1, total): inklusiv 1..total.
		rnd := rand.Intn(total) + 1
		winner := candidates[0]
		acc := 0
		for _, c := range candidates {
			acc += weightOf(c)
			if rnd <= acc {
				winner = c
				break
			}
		}

		// winner_index: Position in den ANGEZEIGTEN Segmenten (Frontend-Rad).
		winnerIndex := 0
		for idx, seg := range displaySegments {
			if seg.seg.ID == winner.seg.ID {
				winnerIndex = idx
				break
			}
		}

		// Lead validieren: gehört zur Kampagne UND spin_id IS NULL.
		var leadID *uint64
		if reqBody.LeadID != 0 {
			var lead models.Lead
			err := tx.Raw(`
				SELECT * FROM leads
				WHERE campaign_id = ? AND id = ? AND spin_id IS NULL
			`, campaignID, reqBody.LeadID).Scan(&lead).Error
			if err != nil {
				return err
			}
			if lead.ID != 0 {
				id := lead.ID
				leadID = &id
			}
		}

		var spinID uint64
		if !isTest {
			// Pool-Eintrag nur bei limitiertem Gewinn holen (RANDOM() wie PHP).
			var poolEntryID uint64
			if !winner.isUnlimited {
				if err := tx.Raw(`
					SELECT id FROM spin_pool
					WHERE campaign_id = ? AND segment_id = ? AND is_used = FALSE
					ORDER BY RANDOM() LIMIT 1
				`, campaignID, winner.seg.ID).Scan(&poolEntryID).Error; err != nil {
					return err
				}
			}

			// Spin speichern.
			spin := models.Spin{
				CampaignID:  campaignID,
				SegmentID:   winner.seg.ID,
				SegmentName: winner.seg.Name,
				WinText:     winner.seg.WinText,
				LeadID:      leadID,
			}
			if err := tx.Create(&spin).Error; err != nil {
				return err
			}
			spinID = spin.ID

			// Pool-Eintrag als used markieren (nur bei limitiertem Gewinn).
			if poolEntryID != 0 {
				now := time.Now()
				if err := tx.Exec(`
					UPDATE spin_pool
					SET is_used = TRUE, used_at = ?, spin_id = ?
					WHERE campaign_id = ? AND id = ?
				`, now, spinID, campaignID, poolEntryID).Error; err != nil {
					return err
				}
			}

			// Lead mit Spin + Gewinn verknüpfen — NICHT bei Respin-Segmenten,
			// damit der Lead für den nächsten echten Dreh erhalten bleibt.
			if leadID != nil && !winner.seg.IsRespin {
				if err := tx.Exec(`
					UPDATE leads SET spin_id = ?, prize = ? WHERE id = ?
				`, spinID, winner.seg.Name, *leadID).Error; err != nil {
					return err
				}
				// TODO: winner email (nach Go-Mailer)
			}
		}

		respStatus = http.StatusOK
		respBody = map[string]any{
			"success":        true,
			"winner":         segmentJSON(winner),
			"winner_index":   winnerIndex,
			"total_segments": len(displaySegments),
			"spin_id":        spinID, // bei ?test=1 == 0
		}
		return nil
	})

	// Fehlerbehandlung nach der Transaktion.
	if txErr != nil {
		if errors.Is(txErr, errCampaignEnded) {
			// Kampagne als beendet markieren (Transaktion wurde zurückgerollt).
			s.DB.Model(&models.Campaign{}).
				Where("id = ?", campaignID).
				Update("status", "ended")
			writeJSON(w, respStatus, respBody)
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Drehen")
		return
	}

	writeJSON(w, respStatus, respBody)
}

// errCampaignEnded signalisiert innerhalb der Transaktion, dass keine Kandidaten
// mehr vorhanden sind — die Transaktion soll zurückgerollt und die Kampagne
// danach auf 'ended' gesetzt werden.
var errCampaignEnded = errors.New("campaign_ended")

// publicCampaignID liest ?campaign_id= für den öffentlichen Spin-Endpunkt.
// TODO Phase 2: device_token → kiosk_sessions.campaign_id.
func publicCampaignID(r *http.Request) (uint64, error) {
	raw := r.URL.Query().Get("campaign_id")
	if raw == "" {
		return 0, errors.New("campaign_id fehlt")
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || parsed == 0 {
		return 0, errors.New("ungültige campaign_id")
	}
	return parsed, nil
}

// DELETE /api/spin?campaign_id=  (Kampagne zurücksetzen, requireAuth)
//
// Port des DELETE-Handlers aus spin.php: spins + spin_pool der Kampagne löschen,
// Pool neu generieren, Status auf 'running' setzen.
func (s *Server) handleDeleteSpin(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var poolSize int
	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`DELETE FROM spins WHERE campaign_id = ?`, campaignID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM spin_pool WHERE campaign_id = ?`, campaignID).Error; err != nil {
			return err
		}
		n, err := pool.GenerateForCampaign(tx, campaignID)
		if err != nil {
			return err
		}
		poolSize = n
		if err := tx.Model(&models.Campaign{}).
			Where("id = ?", campaignID).
			Update("status", "running").Error; err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Zurücksetzen: "+txErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"message":   "Kampagne zurückgesetzt",
		"pool_size": poolSize,
	})
}
