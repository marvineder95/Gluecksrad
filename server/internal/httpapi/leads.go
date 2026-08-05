package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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
	})
}

// GET /api/leads?campaign_id=  (requireAuth)
func (s *Server) handleGetLeads(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/leads?campaign_id=  (öffentlich, rate-limited)
func (s *Server) handlePostLead(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
