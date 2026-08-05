<?php
// E-Mail-Konfiguration für den Versand (Kunden-Zugangsdaten + Gewinn-Mails).
// Sensible Werte (API-Key, SMTP-Passwort) kommen aus email.secret.php,
// die in .gitignore steht und NICHT im Repository liegt.

$emailSecrets = [];
$secretFile = __DIR__ . '/email.secret.php';
if (file_exists($secretFile)) {
    $emailSecrets = require $secretFile;
}

return [
    // === Versand-Treiber ===
    // 'resend' = Versand über Resend HTTP-API (empfohlen, am einfachsten)
    // 'smtp'   = Versand über SMTP-Server (PHPMailer)
    // 'mail'   = PHP mail() (nur Notlösung, schlechte Zustellbarkeit)
    'driver' => $emailSecrets['driver'] ?? 'resend',

    // === Resend (HTTP-API) ===
    'resend_api_key' => $emailSecrets['resend_api_key'] ?? '',

    // === Absender (für alle Treiber) ===
    // MUSS eine Adresse deiner verifizierten Domain sein (SPF/DKIM), sonst Spam.
    'from_email' => $emailSecrets['from_email'] ?? 'noreply@point4studios.at',
    'from_name'  => $emailSecrets['from_name'] ?? 'Point4 Spin',

    // Antwortadresse (optional)
    'reply_to_email' => $emailSecrets['reply_to_email'] ?? '',
    'reply_to_name'  => $emailSecrets['reply_to_name'] ?? '',

    // === SMTP-Server (nur bei driver = 'smtp' relevant) ===
    'smtp_host'   => $emailSecrets['smtp_host'] ?? 'smtp.world4you.com',
    'smtp_port'   => $emailSecrets['smtp_port'] ?? 587,
    'smtp_secure' => $emailSecrets['smtp_secure'] ?? 'tls',
    'smtp_auth'   => true,
    'smtp_username' => $emailSecrets['smtp_username'] ?? '',
    'smtp_password' => $emailSecrets['smtp_password'] ?? '',

    // Debug-Modus für SMTP (0 = aus, 2 = detailliert)
    'debug' => $emailSecrets['debug'] ?? 0,
];
