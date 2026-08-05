package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

// GET /api/segments?campaign_id=
func (s *Server) handleGetSegments(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/segments  (create or update wenn ?id= vorhanden)
func (s *Server) handlePostSegment(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// PUT /api/segments  (bulk sort_order update)
func (s *Server) handlePutSegments(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// DELETE /api/segments?id=  (soft delete)
func (s *Server) handleDeleteSegment(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
