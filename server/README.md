# Glücksrad – Backend (Go + PostgreSQL)

Neuer Backend-Service (ersetzt schrittweise das PHP-Backend). Siehe `../REWRITE-PLAN.md`.

## Stack
- Go + `chi` (HTTP), `gorm` (Modelle/CRUD) + Raw-SQL für Pool-/Statistik-Logik
- PostgreSQL (Dev: Docker, Prod: nativ auf dem Server)
- Auth: Bearer-Token (Tabelle `users.api_token`)

## Lokal starten (Dev)
```bash
cd server
make db-up        # Postgres via Docker auf Host-Port 5433
make run          # API auf http://localhost:8090  (legt Tabellen an + Super-Admin)
```

Super-Admin beim ersten Start: `admin@point4studio.at` / `admin123` (bitte ändern).

## Smoke-Test
```bash
curl localhost:8090/api/health
curl -X POST localhost:8090/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@point4studio.at","password":"admin123"}'
```

## Status
- **Phase 0 (fertig):** Skelett, DB-Anbindung, AutoMigrate (customers/users/campaigns), Auth (login/me/logout), Health.
- **Phase 1 (nächste):** volle Modelle + Kampagnen-Scope, Endpunkte (segments/settings/spin/stats/leads/export), Pool-Logik + Tests, versionierte Migrationen (goose), Dashboard-Kampagnen-CRUD.
- **Phase 2/3:** QR-Pairing + WebSocket, Benachrichtigungen. Siehe `../TASK4-PLAN.md`.
