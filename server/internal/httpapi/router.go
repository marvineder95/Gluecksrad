package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"gorm.io/gorm"
)

// Server bündelt Abhängigkeiten für die Handler.
type Server struct {
	DB *gorm.DB
}

func New(db *gorm.DB) *Server {
	return &Server{DB: db}
}

// Router baut den HTTP-Router mit allen Routen auf.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/api/health", s.handleHealth)

	// Auth
	r.Post("/api/auth/login", s.handleLogin)
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/auth/me", s.handleMe)
		pr.Post("/api/auth/logout", s.handleLogout)
	})

	// Weitere Endpunkte (segments, settings, campaigns, spin, ...) folgen in Phase 1.
	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// DB-Ping über eine triviale Query
	sqlDB, err := s.DB.DB()
	if err != nil || sqlDB.Ping() != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "db_down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}
