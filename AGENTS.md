# Point4 Spin / Glücksrad – Agent Guide

> Diese Datei ist für KI-Coding-Agenten gedacht. Sie beschreibt den Aufbau, die Technologie, die wichtigsten Konventionen und den Betrieb des Projekts so präzise wie möglich, basierend auf dem tatsächlichen Quellcode.

---

## 1. Projektübersicht

**Point4 Spin** (im Code meist „Glücksrad“) ist eine webbasierte Plattform für interaktive Glücksräder bei Events, Promotion-Aktionen und Messen. Kernfunktionen:

* Konfigurierbares Glücksrad mit Segmenten (Gewinne), Themes, Logo und Hintergrundbild.
* Pool-basierte Gewinnverteilung: Jedes Segment hat ein exaktes Kontingent (`max_count`). Das System stellt sicher, dass ein Gewinn nicht öfter vergeben wird als vorgesehen.
* Mehrere Mandanten (Kunden) mit getrennten Daten, Benutzern und Kampagnen.
* Rollenbasierte Berechtigung: Super Admin verwaltet Kunden und Benutzer; Customer Admin verwaltet Segmente, Branding und führt das Event durch.
* Öffentliche Event-Seite (`#/event`) zum Drehen am Touchscreen, inklusive Buzzer-/Tastatur-Unterstützung (Leertaste / Enter).

Das Projekt ist bewusst einfach gehalten: keine Node.js-Build-Pipeline, kein Bundler, kein `package.json`. Frontend und Backend werden direkt von einem PHP-fähigen Webserver ausgeliefert.

---

## 2. Technologie-Stack

| Schicht | Technologie |
| --- | --- |
| Server | PHP 8.x (aktuell PHP 8.5.2 im Entwicklungs-Setup) |
| Datenbank | SQLite (`database/gluecksrad.sqlite`) |
| Frontend-Framework | Vue 3 Global Build via CDN (`vue.global.js`) |
| Styling | Eigenes CSS (`frontend/css/style.css`) |
| Icons | Inline-SVG, teilweise `frontend/js/utils/icons.js` |
| Sound-Effekte | Web Audio API (`frontend/js/utils/sounds.js`) |
| Background-Removal (optional) | Python 3 + `rembg` (`backend/utils/remove_bg.py`) |
| PWA | `manifest.json` + `sw.js`; `frontend/js/app.js` registriert den Service-Worker |

Wichtige Abhängigkeiten:

* PHP-Extensions: PDO + SQLite, GD (für `optimizeImage`), `finfo`.
* Python (nur für Hintergrund-Entfernung): `rembg`, `Pillow` im `venv/`.

---

## 3. Verzeichnisstruktur

```
.
├── index.html                 # Einstiegspunkt, enthält alle Vue-Templates + Script-Tags
├── manifest.json              # PWA-Manifest
├── sw.js                      # Service-Worker (wird für PWA registriert)
├── .htaccess                  # Sicherheitsregeln für Apache
├── AGENTS.md                  # Diese Datei
├──
├── backend/
│   ├── api/                   # REST-ähnliche JSON-Endpunkte
│   │   ├── auth.php           # Login, Logout, Auth-Status, Passwort ändern
│   │   ├── campaign.php       # Kampagne archivieren / komplett zurücksetzen
│   │   ├── customers.php      # Kundenverwaltung (nur Super Admin)
│   │   ├── segments.php       # CRUD + Sortieren von Segmenten
│   │   ├── settings.php       # Branding-Einstellungen speichern/laden
│   │   ├── spin.php           # Rad drehen (echt + Test)
│   │   ├── stats.php          # Dashboard-Statistiken
│   │   ├── themes.php         # Liste der Hintergrund-Themes
│   │   └── users.php          # Benutzerverwaltung (nur Super Admin)
│   ├── config/
│   │   ├── bootstrap.php      # CORS, Session, Auth, Rate-Limiting, CSP, Helper
│   │   └── database.php       # SQLite-Verbindung (PDO)
│   ├── utils/
│   │   ├── pool.php           # generateSpinPool()
│   │   └── remove_bg.py       # Python-Hilfsskript für Hintergrund-Entfernung
│   ├── uploads/               # Kundenspezifische Uploads (Logos, Hintergründe, Segment-Bilder)
│   ├── tests/
│   │   └── pool_tests.php     # Umfangreiche Pool-Tests
│   ├── setup.php              # Einmalige Initialisierung der SQLite-DB
│   ├── migrate.php            # Kleine Schema-Migrationen
│   ├── migrate_pool.php       # Migration zur pool-basierten Verteilung
│   └── migrate_tenant.php     # Migration zur Multi-Tenant-Architektur
│
├── database/
│   ├── schema.sql             # Komplettes DB-Schema inkl. Default-Super-Admin
│   └── gluecksrad.sqlite      # Produktive SQLite-Datei
│
├── frontend/
│   ├── css/style.css          # Globales Styling
│   ├── js/
│   │   ├── app.js             # Vue-App, Routing, Auth-Guard
│   │   ├── config.js          # Konstanten, Themes, Segment-Themes
│   │   ├── components/
│   │   │   └── WheelComponent.js   # SVG-basierte Rad-Komponente
│   │   ├── pages/
│   │   │   ├── DashboardPage.js      # Kunden-Dashboard mit Segment-/Branding-Verwaltung
│   │   │   ├── EventPage.js          # Öffentliche Event-Seite
│   │   │   ├── LandingPage.js        # Login/Landing
│   │   │   └── SettingsPage.js       # Super-Admin Einstellungen & Kundenverwaltung
│   │   └── utils/
│   │       ├── api.js         # Fetch-Wrapper mit Auth-Headern
│   │       ├── auth.js        # Login-State, localStorage, Navigation
│   │       ├── confetti.js    # Canvas-Konfetti-Effekt
│   │       ├── icons.js       # SVG-Icon-Bibliothek
│   │       ├── sounds.js      # Web-Audio-Soundeffekte
│   │       └── spinAnimation.js   # Shared Spin-Animation
│   └── assets/
│       ├── img/               # Produkt-Logos, Landing-Page-Bilder
│       ├── themes/            # Hintergrund-Themes (dove, ocean, …)
│       └── segment-themes/    # Segment-Hintergründe (floral, gold, …)
│
└── venv/                      # Python-Virtualenv für rembg
```

---

## 4. Architektur

### 4.1 Frontend

* **Single-Page-Application (SPA)** mit Hash-Routing (`#/dashboard`, `#/settings`, `#/event`, …).
* Alle Vue-Komponenten werden als globale Konstanten definiert (keine ES-Module) und in `index.html` über einfache `<script>`-Tags geladen.
* Cache-Busting erfolgt manuell über `?v=XX`-Query-Parameter in `index.html`.
* Templates liegen ebenfalls in `index.html` als `<template id="...">`.

Wichtige Routen (`frontend/js/app.js`):

| Hash | Komponente | Auth |
| --- | --- | --- |
| `#/` | `LandingPage` | nein |
| `#/login` | `LandingPage` | nein |
| `#/dashboard` | `DashboardPage` | ja (Kunden-Admin; Super-Admin sieht Zahnrad für Einstellungen) |
| `#/settings` | `SettingsPage` | ja (nur Super Admin) |
| `#/event` | `EventPage` | nein (öffentlich) |

### 4.2 Backend

* Jeder Endpunkt in `backend/api/*.php` ist ein eigenständiges Skript.
* Jeder Endpunkt lädt `backend/config/bootstrap.php`, das wiederum `database.php` lädt.
* Authentifizierung funktioniert über PHP-Session ODER Bearer-Token aus dem `Authorization`-Header.
* State-changing Requests (POST/PUT/DELETE) erfordern ein gültiges `X-CSRF-Token`.
* Mandantenfilter: Fast alle Daten sind an `customer_id` gebunden. Super Admins können optional `?customer_id=…` übergeben.

### 4.3 Datenbank-Modell

Zentrale Tabellen:

* `customers` – Mandanten/Kunden.
* `users` – Authentifizierte Benutzer; Rollen `super_admin` und `customer_admin`.
* `segments` – Gewinne/Segmente pro Kunde (`max_count`, `sort_order`, `theme`, `image`).
* `settings` – Key-Value-Einstellungen pro Kunde (Branding, Kampagnenstatus).
* `spins` – Protokoll aller echten Drehungen.
* `spin_pool` – **Pool-basierte Verteilung**: Für jedes Segment werden exakt `max_count` Einträge erzeugt, gemischt (`shuffle`) und beim Drehen zufällig konsumiert.
* `campaign_archives` – Archivierte Kampagnen.
* `rate_limits` – Login-/Request-Rate-Limiting.

### 4.4 Pool-basierte Verteilung

Die kritische Geschäftslogik:

1. Beim Anlegen/Ändern eines Segments mit `max_count > 0` erzeugt `adjustPoolForSegment()` in `segments.php` genau so viele unbenutzte Pool-Einträge.
2. `generateSpinPool()` in `backend/utils/pool.php` erstellt pro aktivem Segment `max_count` Einträge und mischt sie.
3. `spin.php` wählt einen zufälligen, noch nicht benutzten Pool-Eintrag aus, markiert ihn als `is_used = 1` und speichert den Spin.
4. Sind alle Einträge verbraucht, wird die Kampagne automatisch auf `ended` gesetzt.

Dadurch ist garantiert, dass z. B. ein „Hauptgewinn“ exakt 1×, ein „Trostpreis“ exakt 50× vergeben wird.

---

## 5. Build-, Test- und Setup-Kommandos

> Es gibt **keinen Build-Schritt**. Das Projekt wird direkt von einem PHP-fähigen Webserver ausgeliefert.

### Lokale Entwicklung

Einfachster Weg mit PHPs eingebautem Server:

```bash
php -S localhost:8080
```

Dann im Browser `http://localhost:8080` öffnen.

### Erstinitialisierung der Datenbank

```bash
php backend/setup.php
```

* Legt `database/gluecksrad.sqlite` an und führt `database/schema.sql` aus.
* Erstellt einen Default-Super-Admin (`admin@point4studio.at`).
* Das initiale Passwort ist ein zufälliger Hash – muss sofort im Admin-Panel geändert werden.

### Migrationen (bei bestehender DB)

Die Migrations-Skripte sind idempotent und sollten in dieser Reihenfolge ausgeführt werden, falls eine ältere Datenbank vorliegt:

```bash
php backend/migrate_tenant.php   # Multi-Tenant-Spalten + Kunden-Tabelle
php backend/migrate_pool.php     # spin_pool + campaign_archives
php backend/migrate.php          # Schema-Erweiterungen + Default-Settings
```

### Tests ausführen

```bash
php backend/tests/pool_tests.php
```

* Erstellt eine Kopie der aktuellen DB (`database/test_gluecksrad.sqlite`).
* Testet exakte Gewinnkontingente, Zufälligkeit, Persistenz, Server-Neustart, Test-Spins ohne Verbrauch usw.
* **Wichtig:** `backend/tests/` ist in `.gitignore` ausgeschlossen.

### Optional: Python-Umgebung für Background-Removal

```bash
python3 -m venv venv
source venv/bin/activate
pip install rembg pillow
```

Aktuell ist die Funktion im Hosting-Betrieb deaktiviert; die UI zeigt entsprechend einen Hinweis an.

---

## 6. Code-Stil und Konventionen

### Sprache

* **UI-Texte und Backend-Kommentare sind auf Deutsch.** Neue Fehlermeldungen, Labels und Kommentare sollten ebenfalls auf Deutsch verfasst werden.
* Variablen/Funktionsnamen im Code sind meist englisch (`customerId`, `segments`, `generateSpinPool`).

### PHP

* Kein Framework; pro Datei ein Endpunkt.
* Jeder Endpunkt beginnt mit `require_once __DIR__ . '/../config/bootstrap.php';`.
* Datenbankzugriff ausschließlich über `getDB()` und Prepared Statements.
* JSON-Antworten über `jsonResponse($data, $status)`.
* State-changing Endpunkte rufen `requireCustomerAdmin()` bzw. `requireSuperAdmin()` und `validateCsrf()` auf.
* Transaktionen (`beginTransaction` / `commit` / `rollBack`) bei mehreren zusammengehörigen DB-Operationen.

### JavaScript / Vue

* Vue 3 Global Build (`Vue.ref`, `Vue.computed`, `Vue.onMounted`, …).
* Komponenten sind Konstanten mit `setup()` und `template: '#id'`.
* Shared Utilities liegen unter `frontend/js/utils/` und sind globale Funktionen/Klassen (`api`, `saveAuth`, `SoundFX`, `Confetti`, `runSpinAnimation`).
* Dateiuploads werden als `FormData` an `api.postForm()` übergeben.
* Cache-Busting: Wenn JS/CSS-Dateien geändert werden, die Versionsnummer in `index.html` hochziehen (z. B. `?v=31`).

### CSS

* Alles in einer Datei: `frontend/css/style.css`.
* BEM-ähnliche Klassennamen mit Bindestrichen (z. B. `.admin-card`, `.landing-hero-section`).

---

## 7. Authentifizierung und Sicherheit

### Auth-Mechanismus

1. Login (`POST /backend/api/auth.php`) prüft E-Mail/Passwort, startet eine PHP-Session und erzeugt einen 30-Tage-Bearer-Token + CSRF-Token.
2. Das Frontend speichert Token und CSRF in `localStorage`.
3. Jeder geschützte Request sendet:
   * `Authorization: Bearer <token>`
   * `X-CSRF-Token: <csrf>`
4. `bootstrap.php` lädt bei Bedarf die Session aus dem Token.
5. Logout (`DELETE /backend/api/auth.php`) invalidiert den Token und zerstört die Session.

### Wichtige Sicherheitsmaßnahmen

* **Passwörter** werden mit `password_hash($pw, PASSWORD_BCRYPT)` gehasht.
* **Rate-Limiting** für Login (5 Versuche / 5 Minuten pro IP+E-Mail) und einige öffentliche Endpunkte (`stats`, `themes`, `spin`).
* **CSRF-Token** wird bei Login generiert und bei POST/PUT/DELETE geprüft.
* **Prepared Statements** überall; `finfo` + Extension/Größen-Prüfung für Uploads.
* **CORS** auf eine Whitelist beschränkt (`bootstrap.php`).
* **CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS** werden gesetzt.
* **.htaccess** blockiert:
  * `.sqlite`, `.sqlite3`, `.db`
  * Setup-/Migrations-/Test-Skripte
  * Python-Dateien
  * Config-Dateien
  * Das `database/`-Verzeichnis und `backend/uploads/` komplett.
* **Uploads** werden mit `bin2hex(random_bytes(8))` zufällig benannt und nach `backend/uploads/customer_<id>/<typ>/` geschrieben.
* **GD-Bildoptimierung** skaliert Logos auf max. 400×200, Hintergründe auf 1920×1080, Segment-Bilder auf 800×800.
* **Pfadvalidierung** für `existing_image` (`validateExistingImagePath`) verhindert Path-Traversal.

### Hinweise für Änderungen

* Wenn du neue Endpunkte hinzufügst, immer `require_once __DIR__ . '/../config/bootstrap.php';` verwenden.
* Bei POST/PUT/DELETE immer `validateCsrf()` aufrufen.
* Bei kundenspezifischen Daten `getCurrentCustomerId()` und `requireCustomerContext()` nutzen.
* Öffentliche Endpunkte (z. B. für Event-Modus) dürfen keine sensiblen Daten leaken.

---

## 8. Deployment

> **Ausführlicher Runbook (Server + Domain + Mail):** siehe `DEPLOYMENT.md`
> (Nginx- und Apache-Konfig, HTTPS, Resend-Mailsetup, Smoke-Test).

**E-Mail-Versand** läuft über einen Treiber in `backend/config/email.secret.php`
(`driver` = `resend` | `smtp` | `mail`). `resend` = HTTP-API (empfohlen, kein SMTP nötig).
Betrifft Kunden-Zugangsdaten **und** Gewinn-Mails (`sendMail()` in `backend/utils/mailer.php`).

1. Projekt auf einen PHP-fähigen Webserver (Apache empfohlen wegen `.htaccess`) kopieren.
2. `database/`- und `backend/uploads/`-Verzeichnisse müssen für PHP beschreibbar sein.
3. `php backend/setup.php` ausführen, um die Datenbank zu initialisieren.
4. Falls die Domain nicht `localhost` ist, CORS-Origin in `backend/config/bootstrap.php` ergänzen.
5. Für HTTPS sicherstellen, dass HSTS aktiv ist (`bootstrap.php`). **PWA-Installation (Add to Homescreen) erfordert HTTPS.**
6. Python-Background-Removal ist optional und meist im Produktiv-Hosting deaktiviert.
7. PWA: Nach größeren Frontend-Updates den `CACHE_NAME` in `sw.js` hochziehen (z. B. `gluecksrad-v3` → `gluecksrad-v4`), damit installierte Tablets die neuen Assets laden.

---

## 9. Wichtige Dateien, die oft geändert werden

| Datei | Zweck |
| --- | --- |
| `index.html` | Templates, Script-Loading, Cache-Busting-Versionen |
| `frontend/js/config.js` | Konstanten, Theme-Listen, Default-Werte |
| `frontend/js/app.js` | Routing, Auth-Guard |
| `frontend/css/style.css` | Globales Styling |
| `backend/config/bootstrap.php` | Sicherheitsheader, Auth, CORS, Upload-Helper |
| `backend/api/*.php` | Geschäftslogik und Endpunkte |
| `database/schema.sql` | DB-Schema (nur für neue Installationen / Referenz) |

---

## 10. Bekannte Besonderheiten und Fallstricke

* **Service-Worker ist aktiv registriert.** `frontend/js/app.js` registriert `sw.js`, um PWA-Installation (Add to Homescreen) zu ermöglichen. Der Worker cacht statische Assets (HTML/JS/CSS network-first, Bilder/Fonts cache-first) und ignoriert API-Requests. Für Updates den Cache-Namen in `sw.js` (`CACHE_NAME`) hochziehen, sonst greifen alte Tablets möglicherweise auf den alten Cache zurück.
* **Keine Bundler-Pipeline.** Änderungen an JS/CSS wirken sich sofort aus, solange der Browser-Cache durch `?v=XX` invalidiert wird.
* **Multi-Tenant-Default:** Wenn kein Kundenkontext ermittelt werden kann, fällt `getCurrentCustomerId()` auf Kunde `1` zurück.
* **Test-Spins** (`?test=1`) verbrauchen keine Pool-Einträge und speichern keine Spins.
* **Segment löschen** ist ein Soft-Delete (`is_active = 0`); unbenutzte Pool-Einträge werden dabei gelöscht.
* **Kampagne zurücksetzen** in `campaign.php?action=reset` löscht Segmente, Spins und Pool unwiderruflich.
* **Background-Removal** ist im UI deaktiviert, weil das Produktiv-Hosting kein Python/rembg bereitstellt. Lokal im `venv` funktioniert es.

---

## 11. Zusammenfassung für Agenten

* Sprache: Deutsch für UI, Kommentare und Dokumentation.
* Kein Build-Tool; Änderungen direkt in den Quelldateien.
* PHP-Backend mit SQLite, alles mandantenspezifisch.
* Pool-basierte Gewinnlogik ist das Herzstück – bei Änderungen an Segmenten/Spins die Pool-Tests laufen lassen.
* Sicherheit ist explizit implementiert: Auth, CSRF, Rate-Limiting, Upload-Validierung, .htaccess.
* Vor größeren Änderungen Backup der SQLite-DB (`database/gluecksrad.sqlite`) anlegen.
