package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"gluecksrad/server/internal/models"
)

type ctxKey string

const userCtxKey ctxKey = "user"

func userFromContext(ctx context.Context) *models.User {
	u, _ := ctx.Value(userCtxKey).(*models.User)
	return u
}

// requireAuth prüft den Bearer-Token und legt den User in den Context.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		token := strings.TrimPrefix(auth, "Bearer ")
		if token == "" || token == auth {
			writeError(w, http.StatusUnauthorized, "Nicht authentifiziert")
			return
		}
		var user models.User
		if err := s.DB.Where("api_token = ?", token).First(&user).Error; err != nil {
			writeError(w, http.StatusUnauthorized, "Ungültiger Token")
			return
		}
		if user.APITokenExpires != nil && user.APITokenExpires.Before(time.Now()) {
			writeError(w, http.StatusUnauthorized, "Token abgelaufen")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, &user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireSuperAdmin setzt requireAuth voraus.
func (s *Server) requireSuperAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u := userFromContext(r.Context()); u == nil || u.Role != "super_admin" {
			writeError(w, http.StatusForbidden, "Zugriff verweigert")
			return
		}
		next.ServeHTTP(w, r)
	})
}
