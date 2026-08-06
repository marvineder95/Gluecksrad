package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"gorm.io/gorm"
)

// Server bündelt Abhängigkeiten für die Handler.
type Server struct {
	DB        *gorm.DB
	StaticDir string
}

func New(db *gorm.DB, staticDir string) *Server {
	return &Server{DB: db, StaticDir: staticDir}
}

// Router baut den HTTP-Router mit allen Routen auf.
// Jede Domain hat eine eigene routeXxx()-Methode in einer eigenen Datei —
// parallele Agenten dürfen NUR ihre jeweilige Datei anfassen.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	// Health-Check (öffentlich)
	r.Get("/api/health", s.handleHealth)

	// Auth (Login öffentlich; Me/Logout erfordern Token)
	r.Post("/api/auth/login", s.handleLogin)
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/auth/me", s.handleMe)
		pr.Put("/api/auth/me", s.handleChangePassword)
		pr.Patch("/api/auth/me", s.handleChangeEmail)
		pr.Post("/api/auth/logout", s.handleLogout)
	})

	// Domain-Router — jeder Agent füllt seine eigene Datei aus.
	// Auth-Anforderungen sind in den jeweiligen routeXxx()-Methoden festgelegt
	// (entsprechend der PHP-Logik; kommentiert in den Stub-Dateien).
	s.routeSegments(r)
	s.routeSettings(r)
	s.routeSpin(r)
	s.routeStats(r)
	s.routeLeads(r)
	s.routeExport(r)
	s.routeCustomers(r)
	s.routeUsers(r)
	s.routeCampaigns(r)

	// Statisches Frontend (SPA-Fallback) — alles außer /api/*.
	if s.StaticDir != "" {
		r.Handle("/*", StaticHandler(s.StaticDir))
	}

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
