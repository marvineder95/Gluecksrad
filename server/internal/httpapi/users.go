package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routeUsers montiert die Users-Endpunkte.
//
// Auth-Regeln (aus users.php):
//   - Alle Methoden → requireSuperAdmin.
//
// Routen:
//   - GET    /api/users                       → Liste aller Benutzer
//   - POST   /api/users                       → Neuen Benutzer anlegen
//   - POST   /api/users?action=reset_password&id= → Passwort zurücksetzen
//   - PUT    /api/users?id=                   → Benutzer bearbeiten
//   - DELETE /api/users?id=                   → Benutzer löschen (kein Super-Admin-Löschen)
func (s *Server) routeUsers(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Use(s.requireSuperAdmin)
		pr.Get("/api/users", s.handleGetUsers)
		pr.Post("/api/users", s.handlePostUser)
		pr.Put("/api/users", s.handlePutUser)
		pr.Delete("/api/users", s.handleDeleteUser)
	})
}

// GET /api/users
func (s *Server) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// POST /api/users  (anlegen ODER ?action=reset_password&id=)
func (s *Server) handlePostUser(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// PUT /api/users?id=
func (s *Server) handlePutUser(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}

// DELETE /api/users?id=
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "TODO Phase 1")
}
