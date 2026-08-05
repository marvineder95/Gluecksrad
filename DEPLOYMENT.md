# Wdrożenie na własnym serwerze (pod domeną)

Praktyczny runbook. Projekt to czysty PHP + SQLite + statyczny frontend (Vue z CDN),
**bez kroku build**. Wdrożenie = wgranie plików + konfiguracja serwera WWW + HTTPS + maile.

Zakładamy, że aplikacja pójdzie pod subdomenę, np. `spin.twojadomena.tld`, obok
istniejących projektów (strona, Go/Vue).

---

## 0. Wymagania serwera

- **PHP 8.1+** (najlepiej 8.2/8.3) jako **PHP-FPM** (dla Nginx) lub `mod_php` (dla Apache).
- Rozszerzenia PHP: `pdo_sqlite`, `curl`, `gd`, `zip`, `mbstring`, `json`.
- Nginx **lub** Apache.

Sprawdzenie:

```bash
php -v
php -m | grep -Ei 'pdo_sqlite|curl|gd|zip|mbstring'   # muszą się pokazać wszystkie
```

Jeśli czegoś brakuje (Debian/Ubuntu):
```bash
sudo apt install php-fpm php-sqlite3 php-curl php-gd php-zip php-mbstring
```

> `gd` i `zip` są potrzebne do eksportu XLSX/PDF. `curl` — do wysyłki maili przez Resend.

---

## 1. Który serwer WWW masz? (wykrycie)

Skoro nie masz pewności, sprawdź co nasłuchuje na 80/443 i co jest zainstalowane:

```bash
sudo ss -ltnp | grep -E ':80|:443'      # pokaże proces: nginx / apache2 / caddy
nginx -v 2>/dev/null;  apache2 -v 2>/dev/null; httpd -v 2>/dev/null
sudo systemctl status nginx apache2 2>/dev/null | grep -E 'Active|Loaded'
```

- Widzisz `nginx` → sekcja **2A**.
- Widzisz `apache2`/`httpd` → sekcja **2B**.
- Masz projekt Go/Vue za reverse-proxy → to prawie na pewno **Nginx**.

---

## 2. Umieszczenie plików

Wgraj repo do katalogu poza innymi projektami, np. `/var/www/gluecksrad`
(przez `git clone`, `rsync` albo SFTP). `docroot` = katalog z `index.html`.

```bash
sudo mkdir -p /var/www/gluecksrad
# git clone <repo> /var/www/gluecksrad   (albo rsync/scp)
sudo chown -R www-data:www-data /var/www/gluecksrad
```

Katalogi zapisywalne dla PHP:
```bash
sudo chown -R www-data:www-data /var/www/gluecksrad/database /var/www/gluecksrad/backend/uploads /var/www/gluecksrad/backend/logs
sudo chmod -R u+rwX /var/www/gluecksrad/database /var/www/gluecksrad/backend/uploads /var/www/gluecksrad/backend/logs
```

---

## 2A. Konfiguracja Nginx  ⚠️ .htaccess NIE działa pod Nginx

Nginx ignoruje pliki `.htaccess`, więc reguły bezpieczeństwa trzeba odtworzyć w server-block.
Dostosuj: `server_name`, `root`, wersję `php-fpm` (socket) i ścieżki.

Znajdź socket PHP-FPM:
```bash
ls /run/php/     # np. php8.3-fpm.sock
```

`/etc/nginx/sites-available/gluecksrad.conf`:

```nginx
server {
    listen 80;
    server_name spin.twojadomena.tld;
    root /var/www/gluecksrad;
    index index.html;

    # --- Bezpieczeństwo: blokady odpowiadające .htaccess ---
    location ~ /\.(git|env|htaccess) { deny all; }
    location ^~ /database/            { deny all; }
    location ^~ /backend/config/      { deny all; }
    location ^~ /backend/logs/        { deny all; }
    location ^~ /backend/vendor/      { deny all; }
    location ~* \.(sqlite|sqlite3|db|log)$ { deny all; }
    location ~* /(setup|migrate[^/]*)\.php$ { deny all; }
    location ~* \.py$                 { deny all; }

    # Uploady: serwuj obrazy, ale NIGDY nie wykonuj skryptów
    location ^~ /backend/uploads/ {
        location ~* \.(php|phtml|phar|pl|py|sh|cgi)$ { deny all; }
    }

    # --- PHP przez PHP-FPM ---
    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;   # dostosuj wersję!
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_read_timeout 120;
    }

    # Statyka + SPA (routing jest po stronie #hash, więc wystarcza index.html)
    location / {
        try_files $uri $uri/ /index.html;
    }

    client_max_body_size 25M;   # zgodnie z limitem uploadu obrazów
}
```

Aktywacja:
```bash
sudo ln -s /etc/nginx/sites-available/gluecksrad.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 2B. Konfiguracja Apache  ✅ .htaccess działa od razu

Reguły bezpieczeństwa są już w plikach `.htaccess` (root, `database/`, `backend/uploads/`).
Potrzebny tylko VirtualHost + `mod_php`/`php-fpm` + `AllowOverride All`:

`/etc/apache2/sites-available/gluecksrad.conf`:
```apache
<VirtualHost *:80>
    ServerName spin.twojadomena.tld
    DocumentRoot /var/www/gluecksrad

    <Directory /var/www/gluecksrad>
        Options -Indexes +FollowSymLinks
        AllowOverride All          # WAŻNE: pozwala .htaccess działać
        Require all granted
    </Directory>
</VirtualHost>
```

```bash
sudo a2ensite gluecksrad.conf
sudo a2enmod rewrite
sudo systemctl reload apache2
```

Dodatkowo zablokuj katalog configów (nie ma tam własnego .htaccess):
`backend/config/` zawiera `email.secret.php` — patrz sekcja 6, plik jest wykonywany przez PHP,
więc źródło się nie wycieknie, ale dla pewności możesz dodać `.htaccess` z `Require all denied`
(configi i tak są `require`-owane po stronie serwera, nie z URL).

---

## 3. HTTPS (wymagane — także dla PWA „dodaj do ekranu")

Certbot automatycznie dopisze konfigurację 443 i przekierowanie z 80:

```bash
# Nginx:
sudo certbot --nginx -d spin.twojadomena.tld
# Apache:
sudo certbot --apache -d spin.twojadomena.tld
```

Najpierw ustaw rekord DNS **A/AAAA** subdomeny na IP serwera.

---

## 4. Inicjalizacja bazy danych

Jednorazowo utwórz bazę (albo wgraj istniejący plik `.sqlite`):

```bash
cd /var/www/gluecksrad
sudo -u www-data php backend/setup.php
```

Sprawdź, że baza jest **niedostępna** z zewnątrz (musi zwrócić 403/404):
```bash
curl -I https://spin.twojadomena.tld/database/gluecksrad.sqlite
```

---

## 5. Domena w CORS + zmiana domyślnych haseł

**5.1 CORS** — dopisz swoją domenę w `backend/config/bootstrap.php` (lista `$allowedOrigins`):
```php
'https://spin.twojadomena.tld',
```

**5.2 Domyślne konta** — koniecznie zmień hasła:
- Super-admin: `admin@point4studio.at` (domyślne hasło z instalacji) — zaloguj się i zmień w „Passwort ändern", albo zmień w bazie.
- Konto testowe `hello@kwlc.pl` — usuń lub zmień hasło, jeśli nie jest potrzebne na produkcji.

**5.3 PWA** — po wgraniu nowej wersji frontendu podbij `CACHE_NAME` w `sw.js`
(np. `gluecksrad-v3` → `-v4`), żeby tablety pobrały świeże pliki.

---

## 6. E-mail — konfiguracja Resend (zalecane, „na łatwo")

Kod obsługuje 3 tryby (`driver` w `email.secret.php`): **`resend`** (API HTTP, zalecane),
`smtp` (PHPMailer) lub `mail` (awaryjnie). Dotyczy obu rodzajów maili:
danych dostępowych klienta **oraz** maili z wygraną.

**Krok po kroku (Resend):**

1. Załóż darmowe konto na <https://resend.com>.
2. **Add Domain** → wpisz `twojadomena.tld`. Resend pokaże 2–3 rekordy DNS
   (SPF/DKIM, opcjonalnie DMARC). Dodaj je w panelu DNS domeny i poczekaj na „Verified".
   > Bez zweryfikowanej domeny maile z Twojego adresu wpadną w spam lub zostaną odrzucone.
   > Do samych testów Resend pozwala wysyłać z `onboarding@resend.dev` bez własnej domeny.
3. **API Keys** → *Create API Key* (uprawnienie *Sending access*). Skopiuj klucz `re_...`.
4. Na serwerze utwórz plik sekretny z szablonu:
   ```bash
   cp backend/config/email.secret.php.example backend/config/email.secret.php
   ```
   i wypełnij:
   ```php
   return [
       'driver' => 'resend',
       'resend_api_key' => 're_twoj_klucz',
       'from_email' => 'noreply@twojadomena.tld',   // adres z zweryfikowanej domeny
       'from_name'  => 'Twoje Gewinnspiel',
       'reply_to_email' => 'kontakt@twojadomena.tld',
   ];
   ```
   Plik jest w `.gitignore` — nie trafi do repo. Nadaj mu wąskie uprawnienia:
   ```bash
   sudo chown www-data:www-data backend/config/email.secret.php
   sudo chmod 600 backend/config/email.secret.php
   ```
5. **Maile z wygraną** są domyślnie wyłączone. Jeśli mają wychodzić do uczestników,
   włącz je w ustawieniach kampanii (Winner-E-Mail) i ustaw temat/treść.

**Limity darmowego planu (orientacyjnie — zweryfikuj aktualne na resend.com):**
~100 maili/dobę, ~3 000/miesiąc, 1 zweryfikowana domena. Jeśli spodziewasz się
masowej wysyłki maili z wygraną (>100/dobę na evencie), rozważ plan płatny albo
Brevo (free ~300/dobę) / Amazon SES.

**Diagnostyka:** każda próba wysyłki jest logowana w `backend/logs/mail.log`
(status + ewentualny błąd z API). Przy zakładaniu klienta, jeśli mail nie wyjdzie,
system i tak zwróci wygenerowane hasło w odpowiedzi, żebyś mógł je przekazać ręcznie.

**Alternatywa SMTP** (jeśli wolisz istniejącą skrzynkę): w `email.secret.php` ustaw
`'driver' => 'smtp'` i dane `smtp_host/port/secure/username/password`.

---

## 7. Test końcowy (smoke test)

- [ ] `https://spin.twojadomena.tld` ładuje kiosk, kłódka HTTPS OK.
- [ ] `/database/gluecksrad.sqlite` zwraca 403/404 (nie pobiera pliku).
- [ ] `/backend/config/email.secret.php` nie zwraca treści pliku.
- [ ] Logowanie do dashboardu działa (po zmianie hasła).
- [ ] Test-Drehung w dashboardzie kręci kołem.
- [ ] Eksport XLSX/PDF pobiera plik (wymaga gd+zip).
- [ ] Założenie klienta wysyła maila (sprawdź skrzynkę + `backend/logs/mail.log`).

---

## 8. Aktualizacje w przyszłości

```bash
cd /var/www/gluecksrad && git pull
# podbij CACHE_NAME w sw.js, jeśli zmienił się frontend
sudo systemctl reload nginx   # lub apache2
```

Baza (`database/gluecksrad.sqlite`) i uploady nie są w repo — `git pull` ich nie ruszy.
Przed większymi zmianami rób kopię pliku bazy.
