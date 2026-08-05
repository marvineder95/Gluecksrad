package config

import (
	"os"
)

// Config hält die Laufzeitkonfiguration (12-factor: aus Umgebungsvariablen).
type Config struct {
	DatabaseURL string
	Port        string
	Env         string // "dev" | "prod"
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load liest die Konfiguration aus der Umgebung mit sinnvollen Dev-Defaults.
func Load() Config {
	return Config{
		// Default zeigt auf die lokale Docker-DB (Host-Port 5433).
		DatabaseURL: getenv("DATABASE_URL",
			"host=localhost port=5433 user=gluecksrad password=dev_password dbname=gluecksrad sslmode=disable"),
		Port: getenv("PORT", "8090"),
		Env:  getenv("APP_ENV", "dev"),
	}
}
