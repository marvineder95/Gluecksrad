# HANDOFF — Stand für die nächste Session

Letzte Aktualisierung: 2026-08-11. Branch: **`redesign/dashboard-struktur`** (alles committet + gepusht, working tree clean).
Kommunikation mit dem User: **Polnisch**. Code/UI/Doku: Deutsch. Der User arbeitet zügig, mag „einfach machen"-Momentum, will bei großen Architektur-/Produktentscheidungen aber gefragt werden.

---

## 1. Wo wir stehen (Kurzfassung)
Das Projekt (Multi-Tenant „Glücksrad"-Event-App) wird **von PHP+SQLite auf Go+PostgreSQL umgeschrieben**, mit Kampagnen-Scope von Anfang an (= Task-4-Phase-1 gleich mitgebaut).
- **Phase 1 (Backend-Rewrite) ist FERTIG und End-to-End verifiziert** — lokal, im Browser.
- **Produktion (`spin.kwlc.pl`) läuft noch auf dem ALTEN PHP-Stack.** Der Cutover auf Go ist der nächste konkrete Schritt (Artefakte liegen bereit, s.u.).
- Nächste Schritte in Reihenfolge: **(A) Cutover auf Go** → (B) CI/CD (GitHub Actions) → (C) Task 4 Phase 2 (QR-Pairing + WebSocket + 2 PWAs + Kiosk-Lockdown) → (D) Task 4 Phase 3 (Benachrichtigungen + on_empty=default).

## 2. Architektur jetzt
- **Backend Go** in `/server` (Modul `gluecksrad/server`, Go 1.26): chi (HTTP), **gorm** (Modelle/CRUD) + **Raw-SQL** für Pool-/Statistik-Logik, **goose** Migrationen (embed FS), **pgx**/postgres. Auth = Bearer-Token in `users.api_token`.
- **PostgreSQL** ersetzt SQLite. Alles per **`campaign_id`** gescoped (nicht mehr customer_id). Kampagnen = eigene Segmente/Settings/Pool/Spins/Leads.
- **Frontend** unverändert im Stack (Vue 3 global build, **kein Build-Step**, Hash-Routing), ruft jetzt **`/api/...`** (Go) statt `/backend/api/*.php`. Kampagnen-Switcher im Dashboard; Kiosk liest `campaign_id` aus URL.
- **PHP** (`/backend`) bleibt vorerst im Repo als Rollback, wird nach erfolgreichem Cutover entfernt.

## 3. Lokal starten / verifizieren
```bash
cd server
make db-up        # Docker-Postgres, Host-Port 5433 (Container gluecksrad_pg, gluecksrad/gluecksrad/dev_password)
make run          # Go-API auf :8090; migriert (goose) + seedet Super-Admin; serviert auch das statische Frontend
```
- Browser: `http://localhost:8090/#/login`. **Super-Admin: `admin@point4studio.at` / `admin123`** (Seed).
- Kunde anlegen (Super-Admin) → legt Kunde + Admin-User + **Default-Kampagne** (Segmente/Settings/Pool) an, schickt Zugangsdaten via Resend (lokal ohne RESEND_API_KEY → Passwort kommt in der Response).
- Kiosk: `http://localhost:8090/index.html?campaign_id=<ID>#/event`.
- Tests: `cd server && go test ./...` (Pool/Spin, 11 Tests, brauchen die Docker-DB).

## 4. Wichtige Dateien / Doku
- **`deploy/CUTOVER.md`** — Schritt-für-Schritt Produktions-Cutover (Postgres, systemd, Nginx, Verifikation, Rollback).
- `deploy/gluecksrad-api.service`, `deploy/api.env.example`, `deploy/nginx-spin-additions.conf` — Deploy-Artefakte.
- **`REWRITE-PLAN.md`** — Go/Postgres-Architektur, Endpoint-Mapping, Phasen.
- **`TASK4-PLAN.md`** — Multi-Kampagnen + QR-Pairing + Benachrichtigungen + **2 PWAs** (Entscheidungen §11-13, PWA §8).
- `DEPLOYMENT.md` — ursprüngliches (PHP-)Runbook; für Go gilt CUTOVER.md.

## 5. Nächster konkreter Schritt: CUTOVER (Weg = rsync, NICHT git)
Grund: Der User ist auf `marvineder95/Gluecksrad` nur **Collaborator mit Write, KEIN Admin** → keine Deploy keys, keine Actions-Secrets möglich. Für CI/CD später braucht er **Admin** (marvineder95 muss die Rolle geben / Repo transferieren / Secrets selbst setzen). Für den Cutover ist das egal.

Cutover-Kickoff (aus CUTOVER.md), der User führt es auf dem Server aus:
1. Code auf Server via **rsync vom Mac**:
   `rsync -avz --exclude '.git' --exclude 'server/bin' --exclude 'backend/uploads/customer_*' /Users/damiankawalec/projects/Gluecksrad/ root@IP:/var/www/gluecksrad/`
2. Postgres installieren + Rolle/DB `gluecksrad`.
3. `cd server && go build -o bin/api ./cmd/api` (Server hat Go — bestätigen mit `go version`).
4. `/etc/gluecksrad/api.env` aus `deploy/api.env.example` (DATABASE_URL-Passwort, RESEND_API_KEY).
5. systemd-Unit installieren + `enable --now` → goose migriert, Super-Admin geseedet.
6. Nginx: location-Blöcke aus `deploy/nginx-spin-additions.conf` in den 443-Block; `nginx -t && reload`.
7. Verifizieren (health, Login, Dashboard, Kiosk), Super-Admin-Passwort ändern, echten Kunden anlegen.

Server-Fakten: Nginx (sites-available/enabled: `kwlc.pl`, `verska.kwlc.pl`), PHP-FPM 8.4 (`/run/php/php8.4-fpm.sock`), App unter `/var/www/gluecksrad`. Subdomain `spin.kwlc.pl` (A-Record auf Server-IP, Let's Encrypt aktiv). Resend-Mail funktioniert bereits (Domain kwlc.pl verifiziert).

## 6. Gelöste Entscheidungen (nicht neu aufmachen)
- **Monorepo** (nicht splitten) — kleines Team, geteilter API-Contract, atomare Änderungen; „unabhängige Deploys" via Path-Filter im CI.
- **Go + PostgreSQL vor Task 4**; **gorm + Raw-SQL** (Pool/Stats); Migrationen goose.
- **Kampagnen: voll unabhängig**; `customers.campaign_limit` (zählt ALLE erstellten Kampagnen); beendete Kampagne = terminal (kein Restart), aber klonbar.
- **2 PWAs** (Task 4 Phase 2): `index.html`→`manifest-admin` (standalone, installierbar) + `kiosk.html`→`manifest-kiosk` (fullscreen, **orientation: any**). Behebt zugleich den `start_url`-Bug.
- CI/CD: **Build in GitHub Actions** (cross-compile linux/amd64), rsync Binary+Statik auf Server, systemd restart + Health-Check + Rollback.

## 7. Bekannte TODOs / Lücken im Go-Code (bewusst offen)
- **Winner-E-Mail** im Spin ist noch nicht verdrahtet (`// TODO: winner email (nach Go-Mailer)`), obwohl `internal/mail` existiert — später anschließen.
- **Default-Settings dünn:** `customers.go` seedet nur ~8 Settings-Keys. Der Kiosk füllt fehlende Keys über `CONFIG.DEFAULTS` (Fix in EventPage), aber ein vollständigerer Seed wäre sauberer.
- `POST /api/campaigns/start` & `/end` sind **Phase-2-Stubs** (501) — Kiosk-Pairing.
- **on_empty=default** (weiter-drehen mit Niete) = Phase 3, nur Kommentar-Marker in spins.go.
- **Rate-Limiting** aus PHP nicht portiert (später Middleware/Redis).
- Kiosk-`campaign_id` kommt aus URL-Param — wird in Phase 2 durch **device_token/Pairing** ersetzt.

## 8. Fallstricke / Review-Learnings (damit sie nicht wiederkehren)
- **`SpinPool.TableName()` = "spin_pool"** (gorm würde sonst "spin_pools" pluralisieren). Für weitere per-Hand-Tabellen aufpassen.
- **EventPage merged Settings über `CONFIG.DEFAULTS`** — sonst überschreiben undefined-Tokens die Skin-Defaults → **schwarzes Rad** bei dünnem Settings-Satz.
- **bcrypt**: PHP-Hashes sind `$2y$`, Go normalisiert zu `$2a$` in `verifyPassword` (nötig für Alt-Accounts).
- **settings** akzeptiert POST **und** PUT (Frontend sendet FormData-POST).
- Spalte heißt **`api_token_expires_at`** (nicht `_expires`).
- **Docker/OrbStack-Daemon** ist gelegentlich unerwartet aus (`orb start` oder `open -a OrbStack`, dann `docker start gluecksrad_pg`). Server killt: immer `lsof -ti:8090 | xargs kill -9` vor Neustart, sonst läuft eine alte (stale) Binary weiter.
- Browser-Automation: rAF pausiert in inaktivem Tab → Spin-Animation „friert" scheinbar (kein Logikfehler).

## 9. Orchestrierungs-Setup (wie Phase 1 lief)
Der User will große Arbeit als **Subagenten** (kostengünstige Modelle) + ICH als Reviewer/Integrator. Phase-1-Muster, das gut lief:
- Wellen wegen Abhängigkeiten: **Fundament (Sonnet)** → **Pool/Spin (Opus, kritisch) + Tests** → **Fan-out (7 Agenten, Haiku für Mechanik / Sonnet für Rest, je 1 eigene Datei, KEIN `go build` — ich integriere)**.
- Anti-Konflikt: Router mountet `routeXxx()`, jede Domain eigene Datei; Export fügt Deps über `go mod tidy` (ich) hinzu, Agenten fassen go.mod nicht an.
- Ich (Opus) reviewe + integriere + fixe Nähte + verifiziere E2E + committe pro Welle. In Phase 1 gefundene echte Bugs: siehe §8.

## 10. Was der User als Nächstes tun wird
Cutover auf dem Server ausführen (rsync + CUTOVER.md). Beim Wiederaufnehmen: nach `go version`/`psql --version`-Output fragen bzw. den nächsten CUTOVER-Schritt begleiten. Parallel klärt er ggf. **Admin-Rechte** am Repo (für späteres CI/CD).
