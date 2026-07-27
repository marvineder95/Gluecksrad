#!/usr/bin/env bash
# Startet die Glücksrad-App lokal (PHP-Entwicklungsserver + SQLite).
# Aufruf: ./run.sh [port]   (Standard-Port: 8000)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"

# 1. PHP prüfen (ggf. via Homebrew installieren)
if ! command -v php >/dev/null 2>&1; then
    echo "PHP ist nicht installiert."
    if command -v brew >/dev/null 2>&1; then
        read -r -p "Jetzt mit Homebrew installieren? [y/N] " answer
        if [[ "$answer" =~ ^[yY] ]]; then
            brew install php
        else
            echo "Abbruch. Installiere PHP manuell: brew install php"
            exit 1
        fi
    else
        echo "Homebrew nicht gefunden. Installiere PHP manuell und starte erneut."
        exit 1
    fi
fi

# 2. Datenbank initialisieren, falls noch nicht vorhanden
if [ ! -f database/gluecksrad.sqlite ]; then
    echo "Initialisiere SQLite-Datenbank..."
    php backend/setup.php
fi

# 3. Hinweis auf fehlende E-Mail-Secrets (optional, nur für Mailversand nötig)
if [ ! -f backend/config/email.secret.php ]; then
    echo "Hinweis: backend/config/email.secret.php fehlt – E-Mail-Versand ist deaktiviert."
    echo "         Vorlage: backend/config/email.secret.php.example"
fi

# 4. Server starten (router.php blockiert sensible Pfade wie die SQLite-Datei)
echo ""
echo "App läuft auf: http://localhost:${PORT}"
echo "Beenden mit Ctrl+C"
php -S "localhost:${PORT}" router.php
