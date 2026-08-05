package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routeCampaigns montiert die Campaigns-Endpunkte.
//
// Auth-Regeln: alle Endpunkte erfordern requireAuth (customer_admin oder super_admin).
//
// Routen (aus TASK4-PLAN.md §4):
//   - GET    /api/campaigns              → Liste der Kampagnen des Kunden
//   - POST   /api/campaigns              → Neue Kampagne (mode=empty|copy, source_id?); prüft campaign_limit
//   - PUT    /api/campaigns?id=          → Bearbeiten (name, on_empty, default_segment_id); ended→running blockiert
//   - DELETE /api/campaigns?id=          → Archivieren (soft)
//   - POST   /api/campaigns/clone?id=    → Klonen (auch von ended); ergibt neuen draft
//   - POST   /api/campaigns/start        → Kampagne auf Kiosk-Bildschirm starten (Phase 2: session_id)
//   - POST   /api/campaigns/end          → Kampagne beenden (terminale Aktion)
func (s *Server) routeCampaigns(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/campaigns", s.handleGetCampaigns)
		pr.Post("/api/campaigns", s.handlePostCampaign)
		pr.Put("/api/campaigns", s.handlePutCampaign)
		pr.Delete("/api/campaigns", s.handleDeleteCampaign)
		pr.Post("/api/campaigns/clone", s.handleCloneCampaign)
		pr.Post("/api/campaigns/start", s.handleStartCampaign)
		pr.Post("/api/campaigns/end", s.handleEndCampaign)
	})
}

// GET /api/campaigns
func (s *Server) handleGetCampaigns(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/campaigns  (mode=empty|copy, ?source_id=)
func (s *Server) handlePostCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// PUT /api/campaigns?id=
func (s *Server) handlePutCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// DELETE /api/campaigns?id=  (soft archive)
func (s *Server) handleDeleteCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/campaigns/clone?id=
func (s *Server) handleCloneCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/campaigns/start  {campaign_id, session_id?}
// Phase 2: verknüpft Kampagne mit kiosk_session. Bis Phase 2: setzt nur campaigns.status=running.
func (s *Server) handleStartCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/campaigns/end  {campaign_id}
// Terminale Aktion — ended ist unwiderruflich (nur klonen erlaubt).
func (s *Server) handleEndCampaign(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
