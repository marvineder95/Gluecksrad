# Plan: Multi-Kampanie + parowanie QR + powiadomienia (Zadanie 4)

Status: **plan do akceptacji — jeszcze bez implementacji.**
Decyzje wstępne: kampanie **pełne i niezależne** (własne segmenty, nagrody, design); transport parowania = **polling**.

---

## 1. Cel
1. Klient tworzy i zarządza **wieloma niezależnymi kampaniami** (każda: własne segmenty, nagrody, design, pula, statystyki).
2. **Rozdział kiosk ↔ dashboard** przez parowanie QR/kodem (à la Netflix). Duży ekran pokazuje tylko koło; nie ma z niego dostępu do panelu.
3. **Powiadomienia** w dashboardzie + tryb „nie kończ kampanii, losuj dalej domyślną opcję".
4. **Fix PWA** — instalacja otwiera właściwy ekran.

---

## 2. Model danych

### Nowa tabela `campaigns`
| kolumna | typ | opis |
|---|---|---|
| id | INTEGER PK | |
| customer_id | INTEGER FK | właściciel |
| name | TEXT | nazwa kampanii |
| status | TEXT | `draft` \| `running` \| `paused` \| `ended` \| `archived` |
| on_empty | TEXT | `end` (domyślnie) \| `default` — co robić, gdy pula pusta |
| default_segment_id | INTEGER NULL | segment „Niete/nic" dla trybu `default` |
| estimated_spins | INTEGER | (przeniesione z settings — jest per-kampania) |
| created_at / started_at / ended_at | DATETIME | |

### Dodanie `campaign_id` do istniejących tabel
`segments`, `settings`, `spins`, `spin_pool`, `leads` dostają kolumnę **`campaign_id`** (FK → campaigns).
To czyni kampanię głównym zakresem (scope) pod klientem. Dziś wszystko jest kluczowane `customer_id`; docelowo zapytania idą po `campaign_id`.

> **Uwaga migracyjna:** to duża zmiana — każdy endpoint scope'ujący po `customer_id` (segments, settings, spin, stats, leads) przechodzi na `campaign_id`.

### Nowa tabela `kiosk_sessions` (parowanie)
| kolumna | typ | opis |
|---|---|---|
| id | INTEGER PK | |
| code | TEXT UNIQUE | krótki kod dla człowieka (np. 6 znaków `A7K3Q2`) |
| device_token | TEXT UNIQUE | długi losowy token, trzymany na dużym ekranie (localStorage) |
| customer_id | INTEGER NULL | ustawiany przy parowaniu |
| campaign_id | INTEGER NULL | ustawiany, gdy admin wystartuje kampanię na tym ekranie |
| status | TEXT | `waiting` \| `running` \| `closed` |
| created_at / paired_at / last_seen_at | DATETIME | |

### Nowa tabela `notifications` (opcjonalnie, dla trwałości alertów)
| kolumna | typ | opis |
|---|---|---|
| id, customer_id, campaign_id | | |
| type | TEXT | `pool_depleted` \| `all_prizes_gone` |
| segment_name | TEXT NULL | |
| is_read | INTEGER | |
| created_at | DATETIME | |

---

## 3. Podział ustawień (scope)
Przy pełnych kampaniach trzeba rozdzielić, co jest **per-kampania**, a co **per-klient**:

- **Per-kampania** (przenoszone/kluczowane `campaign_id`): wszystkie design-tokeny (kolory, czcionki, hub, ramki, pointer, button/spin_trigger/spin_hint), `estimated_spins`, `lead_capture_enabled`, `lead_fields`, teksty wygranej, `background_*`, `saved_preset`.
- **Per-klient** (zostają na `customers`/klient): `export_enabled` (płatny feature), konfiguracja e-mail (Resend/SMTP w `email.secret.php`), ewentualnie logo firmowe jako domyślne.

---

## 4. Endpointy (nowe/zmienione)

**Kampanie (dashboard, auth):**
- `GET /api/campaigns` — lista kampanii klienta
- `POST /api/campaigns` — utwórz (klonuje domyślny design albo pustą)
- `PUT /api/campaigns?id=` — edytuj (nazwa, on_empty, default_segment, status)
- `DELETE /api/campaigns?id=` — usuń/archiwizuj
- Wszystkie istniejące (`segments`, `settings`, `spin`, `stats`, `leads`, `export`) — dostają parametr `campaign_id` i scope po nim.

**Parowanie (kiosk, bez auth admina):**
- `POST /api/kiosk/session` → tworzy sesję, zwraca `{code, device_token, qr_payload}`
- `GET /api/kiosk/session?device_token=` → status sesji (`waiting`/`running` + `campaign_id`) — **polling co ~2s**
- `POST /api/kiosk/pair` (auth admina) `{code, campaign_id}` → wiąże sesję z kampanią, `status=running`
- `spin.php` — autoryzacja obrotu przez `device_token` → `campaign_id` (nie fallback `customer_id=1`)

**Powiadomienia (dashboard):**
- `GET /api/notifications?campaign_id=` + `POST .../read`

---

## 5. Flow parowania (Netflix-style)
1. Duży ekran otwiera kiosk (niesparowany) → `POST /api/kiosk/session` → zapisuje `device_token` lokalnie, pokazuje **QR + kod** (`A7K3Q2`).
2. Duży ekran **polluje** `GET /api/kiosk/session` co ~2s.
3. Admin w dashboardzie: wybiera kampanię → „Auf Bildschirm starten" → skanuje QR telefonem **lub** wpisuje kod → `POST /api/kiosk/pair`.
4. Serwer wiąże sesję z kampanią (sprawdza, że kampania należy do klienta admina) → `status=running`.
5. Następny polling dużego ekranu widzi `campaign_id` + `running` → ładuje segmenty/design tej kampanii → pokazuje koło.
6. Każdy obrót idzie z `device_token` → serwer mapuje na `campaign_id`.

**QR koduje:** URL parowania z kodem, np. `https://spin.kwlc.pl/#/pair?code=A7K3Q2` (telefon admina otwiera stronę parowania z wpisanym kodem). Kod tekstowy pozostaje jako fallback do ręcznego wpisania.
**Biblioteka QR:** lekka, z CDN (np. `qrcode` z unpkg — CSP już dopuszcza `unpkg.com`).

---

## 6. Kiosk lockdown (anty-manipulacja)
- Usunięcie „secret corner" (obecne 7 kliknięć → dashboard) z kiosku.
- Wejście kiosku = ekran parowania (niesparowany) → koło (sparowany). Zero linku do panelu.
- Admin wchodzi do dashboardu normalnym logowaniem na swoim urządzeniu.
- Pracownik przy dużym ekranie nie ma jak dostać się do ustawień.

---

## 7. Powiadomienia + tryb „losuj dalej default"
- **`on_empty` = `end`** (dziś): gdy brak kandydatów → kampania kończy się (overlay „zakończona").
- **`on_empty` = `default`**: gdy realne nagrody wyczerpane → koło dalej się kręci i **zawsze ląduje na `default_segment_id`** (segment typu Niete/„nic", unlimited, bez nagrody). Nie ma stanu „ended", dopóki admin sam nie zakończy.
- **Alerty w dashboardzie** (poll co np. 10s podczas podglądu kampanii):
  - „Kontingent für Preis X aufgebraucht"
  - „Alle Preise vergeben — Kampagne beenden?" z przyciskami: *Beenden* / *Weiterlaufen lassen (Default auslosen)*.
- Zdarzenia zapisywane w `notifications` w `spin.php` w momencie wyczerpania (dla trwałości i badge'a).

---

## 8. Fix PWA
- `manifest.json`: `start_url` na ekran kiosku/parowania (np. `/#/kiosk`) zamiast `/` (landing).
- Ewentualnie osobny, minimalny `manifest` dla kiosku (orientacja, pełny ekran).
- Podbicie `CACHE_NAME` w `sw.js` przy wdrożeniu.

---

## 9. Migracja istniejących danych
1. Utwórz tabelę `campaigns` + kolumny `campaign_id`.
2. Dla każdego klienta: utwórz „Standard-Kampagne", przypisz istniejące `segments/settings/spins/spin_pool/leads` (`campaign_id` = ta kampania).
3. `getCurrentCampaignId()`:
   - kiosk → z `device_token`/sesji,
   - dashboard → z wybranej kampanii (parametr/sesja).
4. Skrypt migracyjny idempotentny; kopia bazy przed uruchomieniem.

---

## 10. Fazy implementacji (gdy zaakceptujesz)
- **Faza 1 — Fundament:** tabela `campaigns` + `campaign_id` + migracja; refaktor API na scope kampanii; dashboard: lista kampanii + przełącznik + CRUD + edytor per-kampania. *(największa)*
- **Faza 2 — Parowanie:** `kiosk_sessions`, endpointy sesji/pair, ekran parowania w kiosku, QR, lockdown, fix PWA.
- **Faza 3 — Powiadomienia:** tabela `notifications`, alerty w dashboardzie, tryb `on_empty=default` + `default_segment`.

Każda faza = osobny, testowalny kawałek (i osobne commity/PR).

---

## 11. Otwarte decyzje (do potwierdzenia przed Fazą 1)
1. **Tworzenie kampanii:** nowa kampania startuje jako *kopia* wybranej istniejącej (design+segmenty) czy jako *pusta*? (proponuję: wybór — „pusta" lub „kopiuj z…").
2. **Segment „default" (Niete):** auto-tworzony przy włączeniu `on_empty=default`, czy wskazujesz istniejący segment?
3. **Re-parowanie na żywo:** czy admin może przełączyć duży ekran na inną kampanię bez restartu sesji? (proponuję: tak, przez ponowny `pair`).
4. **QR:** deep-link do strony parowania (wygodne skanowanie telefonem) czy sam kod? (proponuję: deep-link + kod jako fallback).
5. **Historia/archiwum:** czy zakończona kampania ma być archiwizowana (read-only ze statystykami) i klonowalna? (proponuję: tak).
