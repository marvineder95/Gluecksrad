package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"gluecksrad/server/internal/models"

	"gorm.io/gorm"
)

// campaignFromRequest löst die campaign_id für Dashboard-Anfragen auf.
//
// Regelwerk:
//   - Liest ?campaign_id= aus dem Query-String.
//   - Prüft, dass die Kampagne in der DB existiert.
//   - customer_admin: Kampagne muss zu user.CustomerID gehören.
//   - super_admin: darf jede Kampagne verwenden.
//
// Rückgabe: validierte campaign_id oder ein Fehler (bereits geloggter HTTP-Fehler
// wird vom Aufrufer via writeError weitergereicht).
//
// TODO Phase 2 (Kiosk): Wenn kein ?campaign_id= vorhanden, als Fallback
// device_token aus dem Query/Header lesen → kiosk_sessions.campaign_id
// nachschlagen. Erst implementieren, wenn kiosk_sessions-Tabelle existiert.
func (s *Server) campaignFromRequest(r *http.Request, user *models.User) (uint64, error) {
	rawID := r.URL.Query().Get("campaign_id")
	if rawID == "" {
		return 0, errors.New("campaign_id fehlt")
	}

	parsed, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || parsed == 0 {
		return 0, errors.New("ungültige campaign_id")
	}

	var campaign models.Campaign
	if err := s.DB.First(&campaign, parsed).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, errors.New("kampagne nicht gefunden")
		}
		return 0, errors.New("datenbankfehler beim laden der kampagne")
	}

	// Zugriffsprüfung: customer_admin darf nur eigene Kampagnen verwenden.
	if user.Role != "super_admin" {
		if user.CustomerID == nil || campaign.CustomerID != *user.CustomerID {
			return 0, errors.New("zugriff verweigert")
		}
	}

	return campaign.ID, nil
}
