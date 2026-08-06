package httpapi

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"gluecksrad/server/internal/models"
	"gorm.io/datatypes"
)

// routeLeads montiert die Leads-Endpunkte.
//
// Auth-Regeln (aus leads.php):
//   - GET  /api/leads  → requireAuth (nur customer_admin / super_admin)
//   - POST /api/leads  → öffentlich (Kiosk-Teilnehmer gibt Kontaktdaten ein; rate-limited)
//
// Scope: campaign_id (Phase 1). Aufrufer nutzt campaignFromRequest().
func (s *Server) routeLeads(r chi.Router) {
	r.Post("/api/leads", s.handlePostLead)

	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/leads", s.handleGetLeads)
		pr.Delete("/api/leads", s.handleDeleteLead)
	})
}

// handleDeleteLead löscht einen Lead (?id=) der aktuellen Kampagne.
func (s *Server) handleDeleteLead(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	id, _ := strconv.ParseUint(r.URL.Query().Get("id"), 10, 64)
	if id == 0 {
		writeError(w, http.StatusBadRequest, "ID erforderlich")
		return
	}
	res := s.DB.Where("id = ? AND campaign_id = ?", id, campaignID).Delete(&models.Lead{})
	if res.Error != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Löschen")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// leadResponse ist die JSON-Struktur für einen Lead (GET /api/leads).
type leadResponse struct {
	ID           uint64         `json:"id"`
	Name         string         `json:"name"`
	Email        string         `json:"email"`
	SpinID       *uint64        `json:"spin_id"`
	Prize        string         `json:"prize"`
	ConsentGiven bool           `json:"consent_given"`
	Data         datatypes.JSON `json:"data"`
	CreatedAt    string         `json:"created_at"`
}

// GET /api/leads?campaign_id=  (requireAuth)
// Gibt alle Leads einer Kampagne zurück, geordnet nach created_at DESC.
func (s *Server) handleGetLeads(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Nicht authentifiziert")
		return
	}

	// Kampagne validieren und Ownership prüfen
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Leads aus der DB laden
	var leads []models.Lead
	if err := s.DB.Where("campaign_id = ?", campaignID).
		Order("created_at DESC").
		Find(&leads).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden der leads")
		return
	}

	// Leads in Response-Format konvertieren
	response := make([]leadResponse, 0, len(leads))
	for _, lead := range leads {
		response = append(response, leadResponse{
			ID:           lead.ID,
			Name:         lead.Name,
			Email:        lead.Email,
			SpinID:       lead.SpinID,
			Prize:        lead.Prize,
			ConsentGiven: lead.ConsentGiven,
			Data:         lead.Data,
			CreatedAt:    lead.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}

	writeJSON(w, http.StatusOK, response)
}

// postLeadRequest ist die JSON-Struktur für POST /api/leads.
type postLeadRequest struct {
	Name         string                 `json:"name"`
	Email        string                 `json:"email"`
	ConsentGiven bool                   `json:"consent_given"`
	Data         map[string]interface{} `json:"data"`
	CampaignID   *uint64                `json:"campaign_id"`
}

// POST /api/leads?campaign_id=  (öffentlich, rate-limited)
// Erstellt einen neuen Lead mit Walidation.
// Akzeptiert campaign_id aus Query-Parameter oder JSON-Body.
func (s *Server) handlePostLead(w http.ResponseWriter, r *http.Request) {
	var req postLeadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}

	// Name validieren
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name ist erforderlich")
		return
	}

	// Email validieren
	email := strings.TrimSpace(req.Email)
	if email == "" {
		writeError(w, http.StatusBadRequest, "Gültige E-Mail-Adresse ist erforderlich")
		return
	}
	// Nutze net/mail.ParseAddress für robuste Email-Validierung
	if _, err := mail.ParseAddress(email); err != nil {
		writeError(w, http.StatusBadRequest, "Gültige E-Mail-Adresse ist erforderlich")
		return
	}

	// Consent validieren (muss true sein)
	if !req.ConsentGiven {
		writeError(w, http.StatusBadRequest, "Einwilligung erforderlich")
		return
	}

	// campaign_id aus Query-String oder JSON-Body lesen
	var campaignID uint64
	rawID := r.URL.Query().Get("campaign_id")
	if rawID != "" {
		parsed, err := strconv.ParseUint(rawID, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Ungültige campaign_id")
			return
		}
		campaignID = parsed
	} else if req.CampaignID != nil && *req.CampaignID > 0 {
		campaignID = *req.CampaignID
	}

	if campaignID == 0 {
		writeError(w, http.StatusBadRequest, "campaign_id erforderlich")
		return
	}

	// Kampagne prüfen, dass sie existiert
	var campaign models.Campaign
	if err := s.DB.First(&campaign, campaignID).Error; err != nil {
		writeError(w, http.StatusBadRequest, "Kampagne nicht gefunden")
		return
	}

	// Data (JSONB) vorbereiten
	var dataJSON datatypes.JSON
	if req.Data != nil && len(req.Data) > 0 {
		jsonBytes, err := json.Marshal(req.Data)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Fehler bei der Verarbeitung von data")
			return
		}
		dataJSON = datatypes.JSON(jsonBytes)
	}
	// Falls Data leer, bleibt dataJSON nil (NULL in der DB)

	// Lead erstellen
	lead := models.Lead{
		CampaignID:   campaignID,
		Name:         name,
		Email:        email,
		ConsentGiven: true,
		Data:         dataJSON,
	}

	if err := s.DB.Create(&lead).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim speichern des leads")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"id":      lead.ID,
	})
}
