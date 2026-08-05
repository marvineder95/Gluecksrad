package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

// POST /api/spin?campaign_id=  (öffentlich, rate-limited)
func (s *Server) handlePostSpin(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// DELETE /api/spin?campaign_id=  (Kampagne zurücksetzen, requireAuth)
func (s *Server) handleDeleteSpin(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
