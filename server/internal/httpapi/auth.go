package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"gluecksrad/server/internal/models"

	"golang.org/x/crypto/bcrypt"
)

// verifyPassword vergleicht Passwort mit bcrypt-Hash. PHP erzeugt $2y$-Hashes;
// Go's bcrypt erwartet $2a$/$2b$ — die Präfixe sind kompatibel, daher normalisieren.
func verifyPassword(hash, password string) bool {
	if strings.HasPrefix(hash, "$2y$") {
		hash = "$2a$" + hash[4:]
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// POST /api/auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "E-Mail und Passwort erforderlich")
		return
	}

	var user models.User
	if err := s.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		writeError(w, http.StatusUnauthorized, "Ungültige Anmeldedaten")
		return
	}
	if !user.IsActive || !verifyPassword(user.PasswordHash, req.Password) {
		writeError(w, http.StatusUnauthorized, "Ungültige Anmeldedaten")
		return
	}

	token := randomToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	now := time.Now()
	if err := s.DB.Model(&user).Updates(map[string]any{
		"api_token":         token,
		"api_token_expires": expires,
		"last_login_at":     now,
	}).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Login")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"token":   token,
		"user": map[string]any{
			"id":          user.ID,
			"email":       user.Email,
			"role":        user.Role,
			"customer_id": user.CustomerID,
		},
	})
}

// GET /api/auth/me
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"user": map[string]any{
			"id":          user.ID,
			"email":       user.Email,
			"role":        user.Role,
			"customer_id": user.CustomerID,
		},
	})
}

// POST /api/auth/logout
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	s.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
		"api_token":         nil,
		"api_token_expires": nil,
	})
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}
