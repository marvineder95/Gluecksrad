<?php
// E-Mail-Konfiguration für den Versand von Kunden-Zugangsdaten
// Die sensiblen Zugangsdaten (Benutzername + Passwort) werden aus email.secret.php geladen.
// Diese Datei ist in .gitignore eingetragen und wird nicht im Repository gespeichert.

$emailSecrets = [];
$secretFile = __DIR__ . '/email.secret.php';
if (file_exists($secretFile)) {
    $emailSecrets = require $secretFile;
}

return [
    // SMTP-Server Einstellungen (nicht geheim)
    'smtp_host' => 'smtp.world4you.com',     // z.B. smtp.world4you.com, smtp.gmail.com, etc.
    'smtp_port' => 587,                      // 587 für STARTTLS/TLS, 465 für SSL
    'smtp_secure' => 'tls',                  // 'tls' für STARTTLS, 'ssl' oder ''
    'smtp_auth' => true,                     // true/false

    // Absender (nicht geheim)
    'from_email' => 'hello@point4studios.at',   // Absender-E-Mail
    'from_name' => 'Point4 Spin',                // Absender-Name

    // Antwortadresse (optional)
    'reply_to_email' => 'hello@point4studios.at',
    'reply_to_name' => 'Point4 Studios',

    // Sensiblen Zugangsdaten aus der Secret-Datei übernehmen
    'smtp_username' => $emailSecrets['smtp_username'] ?? '',
    'smtp_password' => $emailSecrets['smtp_password'] ?? '',

    // Debug-Modus (für Entwicklung)
    // 0 = aus, 2 = detailliert (nur bei Problemen aktivieren)
    'debug' => 0,
];
