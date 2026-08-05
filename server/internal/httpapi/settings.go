package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

// GET /api/settings?campaign_id=
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// PUT /api/settings?campaign_id=
func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
