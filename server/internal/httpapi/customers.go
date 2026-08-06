package httpapi

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"gluecksrad/server/internal/mail"
	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// customerListRow ist die flache Projektion die GET /api/customers zurückgibt.
type customerListRow struct {
	ID            uint64 `json:"id"`
	CompanyName   string `json:"company_name"`
	ContactName   string `json:"contact_name"`
	Email         string `json:"email"`
	Logo          string `json:"logo"`
	IsActive      bool   `json:"is_active"`
	Subdomain     string `json:"subdomain"`
	ExportEnabled bool   `json:"export_enabled"`
	CampaignLimit int    `json:"campaign_limit"`
	CreatedAt     string `json:"created_at"`
	UserCount     int    `json:"user_count"`
	CampaignCount int    `json:"campaign_count"`
}

// GET /api/customers
// Liste aller Kunden mit Anzahl User und Kampagnen (via Subquery).
func (s *Server) handleGetCustomers(w http.ResponseWriter, r *http.Request) {
	var rows []customerListRow
	err := s.DB.Raw(`
		SELECT
			c.id,
			c.company_name,
			c.contact_name,
			c.email,
			c.logo,
			c.is_active,
			c.subdomain,
			c.export_enabled,
			c.campaign_limit,
			c.created_at,
			(SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id)     AS user_count,
			(SELECT COUNT(*) FROM campaigns ca WHERE ca.customer_id = c.id) AS campaign_count
		FROM customers c
		ORDER BY c.company_name
	`).Scan(&rows).Error
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler: "+err.Error())
		return
	}
	if rows == nil {
		rows = []customerListRow{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// postCustomerRequest ist der erwartete JSON-Body für POST /api/customers.
type postCustomerRequest struct {
	CompanyName string `json:"company_name"`
	ContactName string `json:"contact_name"`
	Email       string `json:"email"`
	Subdomain   string `json:"subdomain"`
}

// POST /api/customers
// Legt einen neuen Kunden an:
//  1. Validierung (email, company_name, Duplikat-Check)
//  2. Transaktion: customer → default-Kampagne → default-Segmente → default-Settings
//     → customer_admin-User → pool.GenerateForCampaign
//  3. Nach Commit: mail.SendCredentials; bei Fehler → password im Response-Body.
func (s *Server) handlePostCustomer(w http.ResponseWriter, r *http.Request) {
	var req postCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiger JSON-Body")
		return
	}

	req.CompanyName = strings.TrimSpace(req.CompanyName)
	req.ContactName = strings.TrimSpace(req.ContactName)
	req.Email = strings.TrimSpace(req.Email)
	req.Subdomain = strings.TrimSpace(req.Subdomain)

	if req.CompanyName == "" {
		writeError(w, http.StatusBadRequest, "Firmenname ist erforderlich")
		return
	}
	if req.Email == "" || !isValidEmail(req.Email) {
		writeError(w, http.StatusBadRequest, "Gültige E-Mail ist erforderlich")
		return
	}

	// Duplikat-Check E-Mail
	var existingUser models.User
	if err := s.DB.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		writeError(w, http.StatusConflict, "E-Mail wird bereits verwendet")
		return
	}

	// Duplikat-Check Subdomain
	if req.Subdomain != "" {
		var existingCustomer models.Customer
		if err := s.DB.Where("subdomain = ?", req.Subdomain).First(&existingCustomer).Error; err == nil {
			writeError(w, http.StatusConflict, "Subdomain wird bereits verwendet")
			return
		}
	}

	// Zufälliges 8-Zeichen Passwort generieren (krypto-sicher)
	plainPassword, err := generatePassword(8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Generieren des Passworts")
		return
	}

	passwordHash, err := hashPassword(plainPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Hashen des Passworts")
		return
	}

	var customerID uint64

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Kunden anlegen
		customer := models.Customer{
			CompanyName: req.CompanyName,
			ContactName: req.ContactName,
			Email:       req.Email,
			Subdomain:   req.Subdomain,
			IsActive:    true,
		}
		if err := tx.Create(&customer).Error; err != nil {
			return err
		}
		customerID = customer.ID

		// 2. Standard-Kampagne anlegen (status: draft)
		displayName := req.CompanyName + " – Kampagne 1"
		campaign := models.Campaign{
			CustomerID:     customerID,
			Name:           displayName,
			Status:         "draft",
			OnEmpty:        "end",
			EstimatedSpins: 100,
		}
		if err := tx.Create(&campaign).Error; err != nil {
			return err
		}
		campaignID := campaign.ID

		// 3. Standard-Segmente (scoped per campaign_id wie im Go-Modell)
		if err := createDefaultSegments(tx, campaignID); err != nil {
			return err
		}

		// 4. Standard-Settings (scoped per campaign_id)
		if err := createDefaultSettings(tx, campaignID); err != nil {
			return err
		}

		// 5. Spin-Pool generieren
		if _, err := pool.GenerateForCampaign(tx, campaignID); err != nil {
			return err
		}

		// 6. Kunden-Admin-User anlegen
		user := models.User{
			Email:        req.Email,
			Username:     req.Email,
			PasswordHash: passwordHash,
			Role:         "customer_admin",
			CustomerID:   &customerID,
			IsActive:     true,
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}

		return nil
	})

	if txErr != nil {
		if strings.Contains(txErr.Error(), "unique") || strings.Contains(txErr.Error(), "UNIQUE") ||
			strings.Contains(txErr.Error(), "duplicate") {
			writeError(w, http.StatusConflict, "E-Mail oder Subdomain wird bereits verwendet")
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Anlegen: "+txErr.Error())
		return
	}

	// Nach Commit: Zugangsdaten per E-Mail senden
	toName := req.ContactName
	if toName == "" {
		toName = req.CompanyName
	}
	mailErr := mail.SendCredentials(req.Email, toName, req.Email, plainPassword)
	emailSent := mailErr == nil

	resp := map[string]any{
		"success":    true,
		"id":         customerID,
		"email_sent": emailSent,
	}
	if !emailSent {
		// Fallback: Passwort im Klartext zurückgeben, damit Super-Admin es manuell weitergibt
		resp["password"] = plainPassword
		resp["email_error"] = mailErr.Error()
	}

	writeJSON(w, http.StatusCreated, resp)
}

// putCustomerRequest ist der JSON-Body für PUT /api/customers?id=.
// Pointer-Felder erlauben Partial-Update (nur gesetzte Felder werden übernommen).
type putCustomerRequest struct {
	CompanyName   *string `json:"company_name"`
	ContactName   *string `json:"contact_name"`
	Email         *string `json:"email"`
	Subdomain     *string `json:"subdomain"`
	IsActive      *bool   `json:"is_active"`
	ExportEnabled *bool   `json:"export_enabled"`
	CampaignLimit *int    `json:"campaign_limit"`
}

// PUT /api/customers?id=
// Partial-Update; synchronisiert auch die E-Mail des customer_admin-Users.
func (s *Server) handlePutCustomer(w http.ResponseWriter, r *http.Request) {
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

	var req putCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiger JSON-Body")
		return
	}

	updates := map[string]any{}
	if req.CompanyName != nil && *req.CompanyName != "" {
		updates["company_name"] = *req.CompanyName
	}
	if req.ContactName != nil {
		updates["contact_name"] = *req.ContactName
	}
	if req.Email != nil {
		if *req.Email != "" && !isValidEmail(*req.Email) {
			writeError(w, http.StatusBadRequest, "Ungültige E-Mail-Adresse")
			return
		}
		updates["email"] = *req.Email
	}
	if req.Subdomain != nil {
		updates["subdomain"] = *req.Subdomain
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.ExportEnabled != nil {
		updates["export_enabled"] = *req.ExportEnabled
	}
	if req.CampaignLimit != nil {
		updates["campaign_limit"] = *req.CampaignLimit
	}

	if len(updates) == 0 {
		writeError(w, http.StatusBadRequest, "Keine Felder zum Aktualisieren")
		return
	}

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.Customer{}).Where("id = ?", id).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errNotFound
		}

		// E-Mail des customer_admin-Users synchronisieren
		if req.Email != nil {
			err := tx.Model(&models.User{}).
				Where("customer_id = ? AND role = ?", id, "customer_admin").
				Updates(map[string]any{"email": *req.Email, "username": *req.Email}).Error
			if err != nil {
				return err
			}
		}
		return nil
	})

	if txErr != nil {
		if errors.Is(txErr, errNotFound) {
			writeError(w, http.StatusNotFound, "Kunde nicht gefunden")
			return
		}
		if strings.Contains(txErr.Error(), "unique") || strings.Contains(txErr.Error(), "UNIQUE") ||
			strings.Contains(txErr.Error(), "duplicate") {
			writeError(w, http.StatusConflict, "E-Mail oder Subdomain wird bereits verwendet")
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Aktualisieren: "+txErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Kunde aktualisiert"})
}

// DELETE /api/customers?id=
// Löscht alle abhängigen Daten in korrekter Reihenfolge (FK), dann den Kunden selbst.
func (s *Server) handleDeleteCustomer(w http.ResponseWriter, r *http.Request) {
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

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// Kampagnen-IDs ermitteln, damit campaign-scoped Tabellen gelöscht werden können
		var campaignIDs []uint64
		if err := tx.Model(&models.Campaign{}).
			Where("customer_id = ?", id).
			Pluck("id", &campaignIDs).Error; err != nil {
			return err
		}

		if len(campaignIDs) > 0 {
			// Kampagnen-scoped Tabellen löschen
			for _, table := range []string{"spin_pool", "spins", "leads", "segments", "settings"} {
				if err := tx.Exec("DELETE FROM "+table+" WHERE campaign_id IN ?", campaignIDs).Error; err != nil {
					return err
				}
			}
		}

		// Kampagnen selbst löschen
		if err := tx.Where("customer_id = ?", id).Delete(&models.Campaign{}).Error; err != nil {
			return err
		}

		// User löschen
		if err := tx.Where("customer_id = ?", id).Delete(&models.User{}).Error; err != nil {
			return err
		}

		// Kunden löschen
		result := tx.Delete(&models.Customer{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errNotFound
		}
		return nil
	})

	if txErr != nil {
		if errors.Is(txErr, errNotFound) {
			writeError(w, http.StatusNotFound, "Kunde nicht gefunden")
			return
		}
		writeError(w, http.StatusInternalServerError, "Fehler beim Löschen: "+txErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Kunde gelöscht"})
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

// errNotFound ist ein Sentinel-Fehler für "0 rows affected" in Transaktionen.
var errNotFound = errors.New("not found")

// createDefaultSegments legt die vier Standard-Segmente für eine Kampagne an.
// Port von createDefaultSegments() aus customers.php; in Go auf campaign_id gescoped.
func createDefaultSegments(tx *gorm.DB, campaignID uint64) error {
	type segDef struct {
		name     string
		color    string
		maxCount int
		theme    string
	}
	defaults := []segDef{
		{"Hauptgewinn", "#FFD700", 1, "gold"},
		{"Gewinn", "#4CAF50", 3, "nature"},
		{"Trostpreis", "#2196F3", 5, "water"},
		{"Nochmal drehen", "#FF9800", 3, "sand"},
	}
	for i, d := range defaults {
		seg := models.Segment{
			CampaignID: campaignID,
			Name:       d.name,
			Color:      d.color,
			WinText:    d.name,
			Weight:     100,
			SortOrder:  i,
			MaxCount:   d.maxCount,
			Theme:      d.theme,
			IsActive:   true,
		}
		if err := tx.Create(&seg).Error; err != nil {
			return err
		}
	}
	return nil
}

// createDefaultSettings legt die Standard-Settings für eine Kampagne an.
// Port von createDefaultSettings() aus customers.php; in Go auf campaign_id gescoped.
func createDefaultSettings(tx *gorm.DB, campaignID uint64) error {
	defaults := map[string]string{
		"primary_color":     "#1E3A8A",
		"secondary_color":   "#F6A7C4",
		"accent_color":      "#D4AF37",
		"font_family":       "Montserrat",
		"wheel_title":       "Glücksrad",
		"theme":             "dove",
		"total_spins_limit": "1000",
	}
	for k, v := range defaults {
		setting := models.Setting{
			CampaignID: campaignID,
			Key:        k,
			Value:      v,
		}
		// INSERT OR IGNORE → OnConflict DoNothing
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&setting).Error; err != nil {
			return err
		}
	}
	return nil
}

// generatePassword erzeugt ein kryptografisch sicheres Zufalls-Passwort
// aus dem Zeichensatz a-z A-Z 0-9 !@#$%^&* mit der gewünschten Länge.
func generatePassword(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
	result := make([]byte, length)
	for i := range result {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		result[i] = charset[n.Int64()]
	}
	return string(result), nil
}

// isValidEmail prüft eine E-Mail-Adresse auf grundlegende Gültigkeit.
func isValidEmail(email string) bool {
	atIdx := strings.Index(email, "@")
	if atIdx < 1 {
		return false
	}
	domain := email[atIdx+1:]
	return strings.Contains(domain, ".") && len(domain) > 2
}
