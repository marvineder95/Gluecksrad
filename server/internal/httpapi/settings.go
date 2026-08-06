package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"gluecksrad/server/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// routeSettings montiert die Settings-Endpunkte.
//
// Auth-Regeln (aus settings.php):
//   - GET /api/settings  → öffentlich (Kiosk liest Design-Tokens ohne Login)
//   - PUT /api/settings  → requireAuth (customer_admin oder super_admin)
//
// Scope: campaign_id (Phase 1). Aufrufer nutzt campaignFromRequest().
// Hinweis: PHP nutzt POST zum Speichern; Go-Rewrite verwendet PUT (idempotent upsert).
func (s *Server) routeSettings(r chi.Router) {
	r.Get("/api/settings", s.handleGetSettings)

	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Put("/api/settings", s.handlePutSettings)
	})
}

// ─── Whitelisted Setting Keys (portiert aus settings.php) ───────────────────────

var textKeys = []string{
	"estimated_spins", "primary_color", "secondary_color", "font_family", "label_font",
	"hub_font", "button_font", "wheel_title", "win_badge_text",
	"win_button_text", "win_default_text",
	"campaign_status", "campaign_started_at", "accent_color", "theme",
	"lead_capture_enabled", "winner_email_enabled", "winner_email_subject",
	"winner_email_sender",
	"segment_fill_mode", "rim_enabled", "rim_style", "rim_color",
	"pointer_position", "hub_color",
	"separator_color", "separator_width", "overlay_strength", "label_enabled",
	"label_color", "label_scale", "label_shadow", "label_shadow_color",
	"hub_content_scale", "spin_button_text", "spin_trigger", "spin_hint",
	"pointer_enabled", "pointer_color", "pointer_style", "rim_glow",
	"segment_gap", "hub_enabled", "hub_type", "hub_shape", "hub_text",
	"hub_text_color", "hub_logo_bg", "hub_text_layout", "hub_size", "segment_palette", "background_mode",
	"background_color", "button_shape", "button_size", "button_color",
	"button_text_color", "button_position",
}

var plainTextKeys = []string{
	"winner_email_body", "wheel_borders", "hub_text", "saved_preset", "lead_fields",
}

// isWhitelistedKey prüft, ob ein Key in der Whitelist ist.
func isWhitelistedKey(key string) bool {
	for _, k := range textKeys {
		if k == key {
			return true
		}
	}
	for _, k := range plainTextKeys {
		if k == key {
			return true
		}
	}
	return false
}

// GET /api/settings?campaign_id=
// Gibt alle Settings einer Kampagne als JSON-Objekt {key: value, ...} zurück.
// Enthält auch "export_enabled" ("1"/"0") vom zugehörigen Kunden.
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	// campaign_id aus Query-String lesen (PUBLIC endpoint, keine Auth nötig)
	rawCampaignID := r.URL.Query().Get("campaign_id")
	if rawCampaignID == "" {
		writeError(w, http.StatusBadRequest, "campaign_id erforderlich")
		return
	}

	campaignID, err := strconv.ParseUint(rawCampaignID, 10, 64)
	if err != nil || campaignID == 0 {
		writeError(w, http.StatusBadRequest, "ungültige campaign_id")
		return
	}

	// Kampagne laden, um customer_id zu ermitteln
	var campaign models.Campaign
	if err := s.DB.First(&campaign, campaignID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusNotFound, "kampagne nicht gefunden")
			return
		}
		writeError(w, http.StatusInternalServerError, "datenbankfehler")
		return
	}

	// Alle Settings der Kampagne laden
	var dbSettings []models.Setting
	if err := s.DB.Where("campaign_id = ?", campaignID).Find(&dbSettings).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "fehler beim laden der settings")
		return
	}

	// In Map umwandeln
	result := make(map[string]string)
	for _, setting := range dbSettings {
		result[setting.Key] = setting.Value
	}

	// export_enabled vom Kunden hinzufügen
	var customer models.Customer
	if err := s.DB.First(&customer, campaign.CustomerID).Error; err == nil {
		if customer.ExportEnabled {
			result["export_enabled"] = "1"
		} else {
			result["export_enabled"] = "0"
		}
	} else {
		result["export_enabled"] = "0"
	}

	writeJSON(w, http.StatusOK, result)
}

// PUT /api/settings?campaign_id=
// Nimmt JSON oder Form-Daten entgegen und UPSERTs die Settings.
// Files (logo, background_image) werden on-the-fly ignoriert (TODO).
func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "nicht authentifiziert")
		return
	}

	// campaign_id validieren via campaignFromRequest
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Daten parsen: JSON oder Form
	var data map[string]string
	contentType := r.Header.Get("Content-Type")

	if strings.Contains(contentType, "application/json") {
		// JSON
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			writeError(w, http.StatusBadRequest, "fehler beim parsen von json")
			return
		}
	} else {
		// Form-Daten (application/x-www-form-urlencoded oder multipart)
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, "fehler beim parsen von form-daten")
			return
		}
		data = make(map[string]string)
		for key, values := range r.PostForm {
			if len(values) > 0 {
				data[key] = values[0]
			}
		}
	}

	// Whitelisted Keys UPSERTen
	for key, value := range data {
		if !isWhitelistedKey(key) {
			// Unbekannte Keys ignorieren (sicher ignorieren, nicht speichern)
			continue
		}

		// UPSERT: Versuche zu aktualisieren, sonst inserieren
		// Via gorm: FirstOrCreate mit Clause("ON CONFLICT ... DO UPDATE")
		setting := models.Setting{
			CampaignID: campaignID,
			Key:        key,
			Value:      value,
		}
		if err := s.DB.Clauses(clause.OnConflict{
			UpdateAll: true,
		}).Create(&setting).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "fehler beim speichern")
			return
		}
	}

	// TODO: file uploads (logo, background_image) → speichern & value aktualisieren

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
