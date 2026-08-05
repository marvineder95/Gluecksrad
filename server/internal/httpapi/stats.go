package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routeStats montiert die Stats-Endpunkte.
//
// Auth-Regeln (aus stats.php):
//   - GET /api/stats  → öffentlich (Dashboard pollt ohne gesonderte Auth;
//     PHP prüft nur campaign/customer via Query-Param).
//     Hinweis: sensible Daten (Leads) sind nur in /api/leads (requireAuth).
//
// Scope: campaign_id (Phase 1). Aufrufer nutzt campaignFromRequest().
func (s *Server) routeStats(r chi.Router) {
	r.Get("/api/stats", s.handleGetStats)
}

// GET /api/stats?campaign_id=
func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
