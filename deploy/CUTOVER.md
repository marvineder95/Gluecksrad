# Cutover: PHP → Go + PostgreSQL (Produktion spin.kwlc.pl)

Einmaliger Umstieg. Danach folgt CI/CD (GitHub Actions). Reihenfolge strikt einhalten,
nach jedem Schritt prüfen. Server: Nginx + PHP-FPM 8.4 (bleibt vorerst installiert), Go-Stack vorhanden.

## 0. Voraussetzungen prüfen
```bash
go version            # Go für den einmaligen Build nötig (fürs CI/CD später nicht mehr)
psql --version        # falls leer -> Schritt 1 installiert Postgres
```

## 1. PostgreSQL installieren + DB/Rolle
```bash
sudo apt update && sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE ROLE gluecksrad LOGIN PASSWORD 'EIN_STARKES_PASSWORT';"
sudo -u postgres psql -c "CREATE DATABASE gluecksrad OWNER gluecksrad;"
```

## 2. Code auf den Server
Wenn noch nicht vorhanden (sonst `git pull`):
```bash
cd /var/www/gluecksrad && git fetch origin && git checkout redesign/dashboard-struktur && git pull
# (nach Merge in main später einfach: git checkout main && git pull)
```

## 3. Go-Binary bauen
```bash
cd /var/www/gluecksrad/server && go build -o bin/api ./cmd/api
```

## 4. Secrets / EnvironmentFile
```bash
sudo mkdir -p /etc/gluecksrad
sudo cp /var/www/gluecksrad/deploy/api.env.example /etc/gluecksrad/api.env
sudo nano /etc/gluecksrad/api.env    # DATABASE_URL-Passwort + RESEND_API_KEY eintragen
sudo chown www-data:www-data /etc/gluecksrad/api.env && sudo chmod 600 /etc/gluecksrad/api.env
```

## 5. systemd-Service (startet API, wendet goose-Migrationen an, seedet Super-Admin)
```bash
sudo cp /var/www/gluecksrad/deploy/gluecksrad-api.service /etc/systemd/system/
sudo mkdir -p /var/www/gluecksrad/uploads && sudo chown -R www-data:www-data /var/www/gluecksrad/uploads
sudo systemctl daemon-reload && sudo systemctl enable --now gluecksrad-api
sudo systemctl status gluecksrad-api --no-pager | head
curl -s http://127.0.0.1:8090/api/health      # -> {"status":"ok"}
```

## 6. Super-Admin-Passwort setzen (Seed-Passwort ist "admin123" – ändern!)
Nach Schritt 7/8 im Browser einloggen (admin@point4studio.at / admin123) und im Dashboard
oben unter „Passwort" ein neues Passwort setzen. (Kein SQL nötig.)
Kontrolle, dass der Seed existiert:
```bash
sudo -u postgres psql -d gluecksrad -c "SELECT id,email,role FROM users;"
```

## 7. Nginx: /api + Statik auf Go umstellen
- Öffne den 443-server-Block: `sudo nano /etc/nginx/sites-available/spin.kwlc.pl`
- Füge die location-Blöcke aus `deploy/nginx-spin-additions.conf` ein.
- Entferne/ersetze eine evtl. vorhandene `location /` die auf PHP zeigt; der PHP-`location ~ \.php$`
  darf bleiben (wird nicht mehr genutzt), stört aber nicht.
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 8. Verifikation (Produktion)
```bash
curl -I https://spin.kwlc.pl/api/health           # 200
curl -I https://spin.kwlc.pl/                      # index.html (200)
```
Im Browser: Login (admin@point4studio.at → neues Passwort), Dashboard lädt, Kampagne anlegen,
Kiosk unter `https://spin.kwlc.pl/index.html?campaign_id=<ID>#/event` dreht.

## 9. Daten
Die alte SQLite-Produktion enthielt praktisch nur den Super-Admin (+ evtl. einen Testkunden).
Empfehlung: Kunden/Kampagnen **neu im Go-Dashboard anlegen** (Mail-Zugangsdaten via Resend).
Kein SQLite→Postgres-Import nötig, solange keine echten Kampagnendaten existieren.

## 10. PHP stilllegen (optional, nach erfolgreicher Verifikation)
- PHP-Endpunkte werden nicht mehr aufgerufen (Frontend nutzt /api). Zum Aufräumen später
  `backend/` aus dem Repo entfernen (eigener Commit) und den PHP-`location` aus Nginx nehmen.

## Rollback
- `sudo systemctl stop gluecksrad-api` und in Nginx die alten `location /` (PHP) wiederherstellen,
  `sudo systemctl reload nginx`. Die alte SQLite-DB bleibt unangetastet.
