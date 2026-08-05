package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routeExport montiert den Export-Endpunkt.
//
// Auth-Regeln (aus export.php):
//   - GET /api/export  → requireAuth (customer_admin / super_admin)
//     Zusätzlich: customers.export_enabled muss true sein (kostenpflichtiges Feature).
//
// Query-Parameter:
//   - ?type=leads|stats   (default: leads)
//   - ?format=xlsx|pdf    (default: xlsx)
//   - ?campaign_id=
//
// Scope: campaign_id (Phase 1).
func (s *Server) routeExport(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/export", s.handleGetExport)
	})
}

// GET /api/export?campaign_id=&type=leads&format=xlsx
func (s *Server) handleGetExport(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
