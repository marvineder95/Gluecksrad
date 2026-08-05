package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gluecksrad/server/internal/config"
	"gluecksrad/server/internal/db"
	"gluecksrad/server/internal/httpapi"
)

func main() {
	cfg := config.Load()

	gdb, err := db.Open(cfg.DatabaseURL, cfg.Env == "dev")
	if err != nil {
		log.Fatalf("DB-Verbindung fehlgeschlagen: %v", err)
	}

	// Versionierte goose-Migrationen statt AutoMigrate.
	if err := db.Migrate(gdb); err != nil {
		log.Fatalf("Migration fehlgeschlagen: %v", err)
	}

	if _, err := db.SeedSuperAdmin(gdb); err != nil {
		log.Fatalf("Seed fehlgeschlagen: %v", err)
	}

	srv := httpapi.New(gdb)
	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      srv.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("API läuft auf http://localhost:%s (env=%s)", cfg.Port, cfg.Env)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server-Fehler: %v", err)
		}
	}()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Println("Fahre herunter...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
