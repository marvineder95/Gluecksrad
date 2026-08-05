package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routeCustomers montiert die Customers-Endpunkte.
//
// Auth-Regeln (aus customers.php):
//   - Alle Methoden → requireSuperAdmin (nur Super-Admin verwaltet Kunden).
//
// Routen:
//   - GET    /api/customers        → Liste aller Kunden
//   - POST   /api/customers        → Neuen Kunden anlegen (inkl. Default-Kampagne + User)
//   - PUT    /api/customers?id=    → Kunde bearbeiten (auch export_enabled)
//   - DELETE /api/customers?id=    → Kunde löschen (cascade)
func (s *Server) routeCustomers(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Use(s.requireSuperAdmin)
		pr.Get("/api/customers", s.handleGetCustomers)
		pr.Post("/api/customers", s.handlePostCustomer)
		pr.Put("/api/customers", s.handlePutCustomer)
		pr.Delete("/api/customers", s.handleDeleteCustomer)
	})
}

// GET /api/customers
func (s *Server) handleGetCustomers(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/customers
func (s *Server) handlePostCustomer(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// PUT /api/customers?id=
func (s *Server) handlePutCustomer(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// DELETE /api/customers?id=
func (s *Server) handleDeleteCustomer(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
