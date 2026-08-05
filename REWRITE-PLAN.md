# Plan rewrite'u: backend Go + PostgreSQL

Status: **plan do akceptacji stacku — przed rozpoczęciem kodowania.**
Decyzje: rewrite backendu na **Go + PostgreSQL PRZED Taskiem 4**; skala „wielu klientów / równoległe eventy”.
Frontend (Vue z CDN, REST) **zostaje bez zmian** poza ścieżkami API.

---

## 1. Zasady
- **Parytet funkcjonalny** z obecnym PHP, ale ze scope’em kampanii (`campaign_id`) wbudowanym od początku → **Faza 1 Taska 4 realizowana w ramach rewrite’u**.
- Zachować sprawdzoną logikę biznesową (pula nagród, ważone losowanie, dystrybucja unlimited) — **1:1 przenieść i pokryć testami**.
- Lekki, „nudny”, niezawodny stack; jeden statyczny binarny plik za Nginx.
- **Spójność z Twoim istniejącym projektem Go/Vue** — dopasować router/warstwę DB/migracje do tego, co już masz (do potwierdzenia).

## 2. Proponowany stack (opinionated — do potwierdzenia)
| Warstwa | Rekomendacja | Alternatywa |
|---|---|---|
| Router/HTTP | `chi` (idiomatyczny net/http + middleware) | stdlib net/http (Go 1.22 routing), echo/gin |
| Dostęp do DB | `pgx` + `sqlc` (typowane Go z SQL, bez magii ORM) | gorm (jeśli tak masz w istniejącym projekcie) |
| Migracje | `goose` | golang-migrate |
| WebSocket (Task 4) | `coder/websocket` | gorilla/websocket |
| Excel/PDF (export) | `excelize` (xlsx), `maroto`/`gofpdf` (pdf) | — |
| Config | zmienne środowiskowe (12-factor) | — |
| Testy | `go test` + testcontainers/pgtap dla puli | — |

> **Pytanie kluczowe:** czego używa Twój istniejący projekt Go (router, warstwa DB, migracje)? Dopasujemy się, żeby był jeden styl.

## 3. Układ repo (monorepo)
```
/server/                 # nowy moduł Go
  cmd/api/main.go        # entrypoint
  internal/
    http/                # handlery, middleware (auth, cors, ratelimit)
    db/                  # sqlc-generated + queries/*.sql
    domain/             # logika: pool, spin, prizes
    mail/                # Resend
    export/              # xlsx/pdf
    ws/                  # websocket hub (Task 4)
  migrations/            # goose *.sql
  Makefile
/frontend/               # bez zmian
/index.html              # zmiana tylko ścieżek API w config.js
```
PHP (`/backend`) zostaje w repo do czasu cutovera, potem usuwany.

## 4. Schemat PostgreSQL (tłumaczenie + Task 4 od razu)
Zmiany względem SQLite: `INTEGER PK AUTOINCREMENT`→`BIGINT GENERATED ... IDENTITY`, `INSERT OR REPLACE`→`ON CONFLICT ... DO UPDATE`, daty→`timestamptz`, bool→`boolean`.

Kluczowe tabele (skrót):
- `customers(id, company_name, email, is_active, subdomain, export_enabled bool, campaign_limit int, created_at)`
- `users(id, email, password_hash, role, customer_id, api_token, api_token_expires_at, ...)`
- **`campaigns(id, customer_id, name, status, on_empty, default_segment_id, estimated_spins, created_at, started_at, ended_at)`** — NOWE
- `segments(id, campaign_id, name, color, win_text, image, max_count, unlimited bool, depleted_behavior, is_respin bool, image_* , sort_order, is_active)` — teraz per-kampania
- `settings(campaign_id, key, value)` — per-kampania; PK (campaign_id, key)
- `spin_pool(id, campaign_id, segment_id, is_used bool, used_at, spin_id, sequence_order)`
- `spins(id, campaign_id, segment_id, segment_name, win_text, lead_id, created_at)`
- `leads(id, campaign_id, name, email, spin_id, prize, consent_given bool, data jsonb, created_at)`
- **`kiosk_sessions(id, code, device_token, customer_id, campaign_id, status, created_at, paired_at, last_seen_at)`** — NOWE
- **`notifications(id, customer_id, campaign_id, type, segment_name, is_read bool, created_at)`** — NOWE
- `rate_limits(...)` lub zastąpić in-memory/Redis później.

`leads.data` → natywny `jsonb` (lepsze niż TEXT+JSON w SQLite).

## 5. Mapowanie endpointów (PHP → Go REST)
Czyste ścieżki bez `.php`; Nginx proxuje `/api/` do Go (127.0.0.1:PORT).
| Teraz (PHP) | Docelowo (Go) |
|---|---|
| `POST /backend/api/auth.php` | `POST /api/auth/login`, `/logout`, `GET /api/auth/me` |
| `GET/POST /backend/api/segments.php` | `GET/POST/PUT/DELETE /api/segments` |
| `GET/POST /backend/api/settings.php` | `GET/PUT /api/settings` |
| `POST /backend/api/spin.php` | `POST /api/spin` |
| `GET /backend/api/stats.php` | `GET /api/stats` |
| `GET/POST /backend/api/leads.php` | `GET/POST /api/leads` |
| `GET /backend/api/export.php` | `GET /api/export` |
| `*/customers.php,users.php` | `/api/customers`, `/api/users` |
| — | **NOWE:** `/api/campaigns*`, `/api/kiosk/*`, `/api/notifications`, `/ws` |

Zakres żądania: `campaign_id` z kontekstu (dashboard: wybrana kampania; kiosk: z `device_token`→sesja).

## 6. Auth
- Zachować model **bearer token** (tabela `users.api_token` + wygasanie) — proste, odwoływalne. Middleware `chi` waliduje token.
- Rola (`super_admin` / `customer_admin`) + scope po `customer_id`/`campaign_id`.
- CSRF mniej krytyczny przy czystym API tokenowym; utrzymać dla parytetu tam, gdzie potrzeba.
- Rate-limiting: middleware (najpierw in-memory per-instancja; przy skali → Redis).

## 7. Real-time (Task 4, Faza 2/3)
- `/ws` (WebSocket) z hubem: kanał per `kiosk_session` i per `campaign`.
- Duży ekran subskrybuje swój kanał → natychmiast dostaje „start/stop kampanii”, brak pollingu.
- Dashboard subskrybuje kanał kampanii → alerty na żywo („pula X wyczerpana”).
- Nginx: masz już `websocket_upgrade.conf` — dodamy `location /ws { proxy_pass ...; Upgrade headers }`.

## 8. Deployment / cutover
1. Go jako **systemd service** słuchający na `127.0.0.1:8090`; Nginx: `location /api/ { proxy_pass http://127.0.0.1:8090; }` + `location /ws`.
2. Frontend statycznie jak dziś; zmiana `CONFIG.API_BASE`/ENDPOINTS na `/api/...`.
3. **Cutover niskiego ryzyka:** produkcja (`spin.kwlc.pl`) ma świeżą bazę (tylko super-admin) → praktycznie brak danych do migracji, można wystartować na czysto.
4. Migracja danych (jeśli trzeba): jednorazowy skrypt SQLite→Postgres (klienci, users, segmenty, settings, pool, spins, leads → przypisane do „Standard-Kampagne”).
5. Po weryfikacji — wyłączyć PHP-FPM vhost/ścieżkę.

## 9. Fazy
- **Faza 0 — Szkielet:** moduł Go, chi, pgx/sqlc, goose, config, healthcheck, Nginx proxy, systemd. „Hello” + `/api/auth`.
- **Faza 1 — Parytet + scope kampanii:** schemat Postgres (z `campaigns`), migracje, endpointy segments/settings/spin/stats/leads/export/customers/users **scoped po campaign_id**, port logiki puli + testy. Dashboard: lista/CRUD kampanii + przełącznik. (= parytet + Faza 1 Taska 4)
- **Faza 2 — Parowanie + WS:** `kiosk_sessions`, `/api/kiosk/*`, ekran parowania (QR+kod), `/ws`, lockdown kiosku, fix PWA.
- **Faza 3 — Powiadomienia + on_empty=default.**

## 10. Ryzyka i mitygacje
- **Logika puli/losowania** — najbardziej wrażliwa; port 1:1 + testy jednostkowe odtwarzające scenariusze (kontyngenty, unlimited, respin, wyczerpanie). Punkt odniesienia: obecne testy puli.
- **Parytet subtelności** (winner_index, total_segments) — kontrakt API musi zwracać te same pola; frontend (z naprawionymi bugami) zostaje.
- **Podwójny stack w trakcie** — trzymać PHP działający do pełnej weryfikacji Go, przełączać ścieżkami w Nginx.

## 11. Do potwierdzenia przed Fazą 0
1. Stack Twojego istniejącego projektu Go (router / warstwa DB / migracje) — dopasować.
2. Postgres: nowa baza na tym serwerze (rola + `CREATE DATABASE gluecksrad`) — czy masz już Postgres, czy stawiamy?
3. Ścieżki API: `/api/...` (zalecane) — OK?
4. Repo: monorepo `/server` (zalecane) czy osobne repo?
