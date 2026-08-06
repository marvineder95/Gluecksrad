package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"gluecksrad/server/internal/models"
	"gorm.io/gorm"
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

// userListRow ist die flache Projektion die GET /api/users zurückgibt.
type userListRow struct {
	ID          uint64  `json:"id"`
	Email       string  `json:"email"`
	Username    string  `json:"username"`
	Role        string  `json:"role"`
	CustomerID  *uint64 `json:"customer_id"`
	IsActive    bool    `json:"is_active"`
	CreatedAt   string  `json:"created_at"`
	LastLoginAt *string `json:"last_login_at"`
	CompanyName *string `json:"company_name"`
}

// GET /api/users
// Gibt alle User mit optionalem company_name des zugehörigen Kunden zurück.
func (s *Server) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	var rows []userListRow
	err := s.DB.Raw(`
		SELECT
			u.id,
			u.email,
			u.username,
			u.role,
			u.customer_id,
			u.is_active,
			u.created_at,
			u.last_login_at,
			c.company_name
		FROM users u
		LEFT JOIN customers c ON u.customer_id = c.id
		ORDER BY u.created_at DESC
	`).Scan(&rows).Error
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler: "+err.Error())
		return
	}
	if rows == nil {
		rows = []userListRow{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// postUserRequest ist der JSON-Body für POST /api/users (Benutzer anlegen).
type postUserRequest struct {
	Email      string  `json:"email"`
	Role       string  `json:"role"`
	CustomerID *uint64 `json:"customer_id"`
	Password   string  `json:"password"`
}

// resetPasswordRequest ist der JSON-Body für POST /api/users?action=reset_password&id=.
type resetPasswordRequest struct {
	Password string `json:"password"`
}

// POST /api/users  (anlegen ODER ?action=reset_password&id=)
func (s *Server) handlePostUser(w http.ResponseWriter, r *http.Request) {
	action := r.URL.Query().Get("action")

	if action == "reset_password" {
		s.handleResetPassword(w, r)
		return
	}

	// ── Benutzer anlegen ──────────────────────────────────────────────────────
	var req postUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiger JSON-Body")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || !isValidEmail(req.Email) {
		writeError(w, http.StatusBadRequest, "Gültige E-Mail ist erforderlich")
		return
	}

	if req.Role == "" {
		req.Role = "customer_admin"
	}
	if req.Role != "super_admin" && req.Role != "customer_admin" {
		writeError(w, http.StatusBadRequest, "Ungültige Rolle")
		return
	}
	if req.Role == "super_admin" {
		writeError(w, http.StatusForbidden, "Super Admin-Benutzer können nicht angelegt werden")
		return
	}
	if req.Role == "customer_admin" && req.CustomerID == nil {
		writeError(w, http.StatusBadRequest, "Kunden-Zuordnung ist für Kunden-Admin erforderlich")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "Passwort muss mindestens 8 Zeichen haben")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Hashen des Passworts")
		return
	}

	user := models.User{
		Email:        req.Email,
		Username:     req.Email,
		PasswordHash: hash,
		Role:         req.Role,
		CustomerID:   req.CustomerID,
		IsActive:     true,
	}
	if err := s.DB.Create(&user).Error; err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "UNIQUE") ||
			strings.Contains(err.Error(), "duplicate") {
			writeError(w, http.StatusConflict, "E-Mail wird bereits verwendet")
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Anlegen: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"id":      user.ID,
		"message": "Benutzer angelegt",
	})
}

// handleResetPassword ist der Handler für POST /api/users?action=reset_password&id=.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeError(w, http.StatusBadRequest, "ID erforderlich")
		return
	}
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige ID")
		return
	}

	var req resetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiger JSON-Body")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "Passwort muss mindestens 8 Zeichen haben")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Hashen des Passworts")
		return
	}

	result := s.DB.Model(&models.User{}).Where("id = ?", id).Update("password_hash", hash)
	if result.Error != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Zurücksetzen: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Passwort zurückgesetzt"})
}

// putUserRequest ist der JSON-Body für PUT /api/users?id=.
// Alle Felder sind optional (Partial-Update).
type putUserRequest struct {
	Email      *string `json:"email"`
	Role       *string `json:"role"`
	CustomerID *uint64 `json:"customer_id"` // null = kein Kunde
	IsActive   *bool   `json:"is_active"`
}

// PUT /api/users?id=
func (s *Server) handlePutUser(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeError(w, http.StatusBadRequest, "ID erforderlich")
		return
	}
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige ID")
		return
	}

	// Rohes JSON merken, um customer_id=null erkennen zu können
	var rawBody map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&rawBody); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiger JSON-Body")
		return
	}

	updates := map[string]any{}

	if raw, ok := rawBody["email"]; ok {
		var email string
		if err := json.Unmarshal(raw, &email); err != nil {
			writeError(w, http.StatusBadRequest, "Ungültige E-Mail")
			return
		}
		email = strings.TrimSpace(email)
		if !isValidEmail(email) {
			writeError(w, http.StatusBadRequest, "Ungültige E-Mail")
			return
		}
		updates["email"] = email
		updates["username"] = email
	}

	if raw, ok := rawBody["role"]; ok {
		var role string
		if err := json.Unmarshal(raw, &role); err != nil {
			writeError(w, http.StatusBadRequest, "Ungültige Rolle")
			return
		}
		if role != "super_admin" && role != "customer_admin" {
			writeError(w, http.StatusBadRequest, "Ungültige Rolle")
			return
		}
		if role == "super_admin" {
			writeError(w, http.StatusForbidden, "Rolle kann nicht zu Super Admin geändert werden")
			return
		}
		updates["role"] = role
	}

	if raw, ok := rawBody["customer_id"]; ok {
		// Erlaubt explizites null (kein Kunde) sowie eine echte ID
		var customerID *uint64
		if string(raw) == "null" {
			customerID = nil
		} else {
			var cid uint64
			if err := json.Unmarshal(raw, &cid); err != nil {
				writeError(w, http.StatusBadRequest, "Ungültige customer_id")
				return
			}
			customerID = &cid
		}
		updates["customer_id"] = customerID
	}

	if raw, ok := rawBody["is_active"]; ok {
		var isActive bool
		if err := json.Unmarshal(raw, &isActive); err != nil {
			writeError(w, http.StatusBadRequest, "Ungültiger Wert für is_active")
			return
		}
		if !isActive {
			// Super-Admin-Konten dürfen nicht deaktiviert werden
			var targetUser models.User
			if err := s.DB.First(&targetUser, id).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
					return
				}
				writeError(w, http.StatusInternalServerError, "Datenbankfehler")
				return
			}
			if targetUser.Role == "super_admin" {
				writeError(w, http.StatusForbidden, "Super Admin-Benutzer können nicht deaktiviert werden")
				return
			}
		}
		updates["is_active"] = isActive
	}

	if len(updates) == 0 {
		writeError(w, http.StatusBadRequest, "Keine Felder zum Aktualisieren")
		return
	}

	result := s.DB.Model(&models.User{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		if strings.Contains(result.Error.Error(), "unique") || strings.Contains(result.Error.Error(), "UNIQUE") ||
			strings.Contains(result.Error.Error(), "duplicate") {
			writeError(w, http.StatusConflict, "E-Mail wird bereits verwendet")
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Aktualisieren: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Benutzer aktualisiert"})
}

// DELETE /api/users?id=
// Löscht einen Benutzer; Super-Admin-Konten sind geschützt.
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeError(w, http.StatusBadRequest, "ID erforderlich")
		return
	}
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "Ungültige ID")
		return
	}

	var targetUser models.User
	if err := s.DB.First(&targetUser, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
			return
		}
		writeError(w, http.StatusInternalServerError, "Datenbankfehler")
		return
	}

	if targetUser.Role == "super_admin" {
		writeError(w, http.StatusForbidden, "Super Admin-Benutzer können nicht gelöscht werden")
		return
	}

	result := s.DB.Delete(&models.User{}, id)
	if result.Error != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Löschen: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Benutzer gelöscht"})
}
