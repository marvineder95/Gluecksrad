package db

import (
	"log"

	"gluecksrad/server/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Open verbindet zu Postgres und liefert eine *gorm.DB.
func Open(dsn string, dev bool) (*gorm.DB, error) {
	logLevel := logger.Warn
	if dev {
		logLevel = logger.Info
	}
	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
}

// AutoMigrate legt die Kern-Tabellen an (Phase 0). Für Produktion später
// versionierte Migrationen (goose); AutoMigrate ist bewusst nur für Dev/Bootstrap.
func AutoMigrate(g *gorm.DB) error {
	return g.AutoMigrate(
		&models.Customer{},
		&models.User{},
		&models.Campaign{},
	)
}

// SeedSuperAdmin legt einen Super-Admin an, falls noch keiner existiert.
// Gibt das initiale Passwort zurück (nur wenn neu angelegt), sonst "".
func SeedSuperAdmin(g *gorm.DB) (string, error) {
	var count int64
	if err := g.Model(&models.User{}).Where("role = ?", "super_admin").Count(&count).Error; err != nil {
		return "", err
	}
	if count > 0 {
		return "", nil
	}
	initialPW := "admin123" // MUSS nach erstem Login geändert werden
	hash, err := bcrypt.GenerateFromPassword([]byte(initialPW), 12)
	if err != nil {
		return "", err
	}
	admin := models.User{
		Email:        "admin@point4studio.at",
		Username:     "admin",
		PasswordHash: string(hash),
		Role:         "super_admin",
		IsActive:     true,
	}
	if err := g.Create(&admin).Error; err != nil {
		return "", err
	}
	log.Println("Super-Admin angelegt: admin@point4studio.at (Passwort: admin123 – bitte ändern!)")
	return initialPW, nil
}
