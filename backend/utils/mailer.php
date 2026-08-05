<?php
require_once __DIR__ . '/../vendor/phpmailer/PHPMailer.php';
require_once __DIR__ . '/../vendor/phpmailer/SMTP.php';
require_once __DIR__ . '/../vendor/phpmailer/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

function getEmailConfig() {
    return require __DIR__ . '/../config/email.php';
}

/**
 * Zentraler Versand. Wählt anhand von config['driver'] den Transportweg.
 * $text ist optional (Plain-Text-Alternative). Rückgabe:
 *   ['success' => bool, 'error' => string|null]
 */
function sendMail($toEmail, $toName, $subject, $html, $text = '') {
    $config = getEmailConfig();
    $driver = $config['driver'] ?? 'smtp';

    if ($driver === 'resend') {
        return sendViaResend($config, $toEmail, $toName, $subject, $html, $text);
    }
    if ($driver === 'mail') {
        return sendViaPhpMail($config, $toEmail, $subject, $html, $text);
    }
    return sendViaSmtp($config, $toEmail, $toName, $subject, $html, $text);
}

/** Versand über die Resend HTTP-API (https://resend.com). */
function sendViaResend($config, $toEmail, $toName, $subject, $html, $text) {
    if (empty($config['resend_api_key'])) {
        return ['success' => false, 'error' => 'Resend API-Key fehlt (email.secret.php)'];
    }
    $fromName = $config['from_name'] ?: 'Point4 Spin';
    $from = $fromName . ' <' . $config['from_email'] . '>';

    $payload = [
        'from' => $from,
        'to' => [$toEmail],
        'subject' => $subject,
        'html' => $html,
    ];
    if (!empty($text)) { $payload['text'] = $text; }
    if (!empty($config['reply_to_email'])) { $payload['reply_to'] = $config['reply_to_email']; }

    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $config['resend_api_key'],
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 15,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);

    if ($response === false) {
        return ['success' => false, 'error' => 'Resend-Verbindung fehlgeschlagen: ' . $curlErr];
    }
    if ($httpCode >= 200 && $httpCode < 300) {
        return ['success' => true];
    }
    $body = json_decode($response, true);
    $msg = is_array($body) && isset($body['message']) ? $body['message'] : $response;
    return ['success' => false, 'error' => 'Resend-Fehler (' . $httpCode . '): ' . $msg];
}

/** Versand über SMTP (PHPMailer). */
function sendViaSmtp($config, $toEmail, $toName, $subject, $html, $text) {
    $mail = new PHPMailer(true);
    $mail->CharSet = 'UTF-8';
    $mail->Encoding = 'base64';

    try {
        $mail->isSMTP();
        $mail->Host = $config['smtp_host'];
        $mail->SMTPAuth = $config['smtp_auth'];
        $mail->Username = $config['smtp_username'];
        $mail->Password = $config['smtp_password'];
        $mail->SMTPSecure = $config['smtp_secure'];
        $mail->Port = $config['smtp_port'];
        $mail->SMTPDebug = $config['debug'];

        $mail->setFrom($config['from_email'], $config['from_name']);
        if (!empty($config['reply_to_email'])) {
            $mail->addReplyTo($config['reply_to_email'], $config['reply_to_name']);
        }
        $mail->addAddress($toEmail, $toName);

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $html;
        if (!empty($text)) { $mail->AltBody = $text; }

        $mail->send();
        return ['success' => true];
    } catch (PHPMailerException $e) {
        return ['success' => false, 'error' => $mail->ErrorInfo];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    }
}

/** Notlösung: PHP mail() (schlechte Zustellbarkeit, kein Auth). */
function sendViaPhpMail($config, $toEmail, $subject, $html, $text) {
    $from = $config['from_email'];
    $headers = 'From: ' . $config['from_name'] . ' <' . $from . '>' . "\r\n"
        . (!empty($config['reply_to_email']) ? 'Reply-To: ' . $config['reply_to_email'] . "\r\n" : '')
        . 'MIME-Version: 1.0' . "\r\n"
        . 'Content-Type: text/html; charset=UTF-8' . "\r\n";
    $ok = @mail($toEmail, $subject, $html, $headers);
    return $ok ? ['success' => true] : ['success' => false, 'error' => 'PHP mail() fehlgeschlagen'];
}

function sendCustomerCredentials($toEmail, $toName, $loginEmail, $plainPassword) {
    return sendMail(
        $toEmail,
        $toName,
        'Ihre Zugangsdaten für Point4 Spin',
        buildCredentialsEmailHtml($toName, $loginEmail, $plainPassword),
        buildCredentialsEmailText($toName, $loginEmail, $plainPassword)
    );
}

/**
 * Gewinn-Mail an einen Lead. $subject/$body sind bereits fertig ersetzte Texte.
 * $body ist Plain-Text; wir schicken ihn als einfache HTML- und Text-Variante.
 */
function sendWinnerEmail($toEmail, $toName, $subject, $body) {
    $html = '<div style="font-family:Montserrat,Arial,sans-serif; font-size:15px; line-height:1.6; color:#0f172a; white-space:pre-wrap;">'
        . nl2br(htmlspecialchars($body)) . '</div>';
    return sendMail($toEmail, $toName, $subject, $html, $body);
}

function buildCredentialsEmailHtml($toName, $loginEmail, $plainPassword) {
    $loginUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') 
        . '://' . ($_SERVER['HTTP_HOST'] ?? 'spin.point4studios.at') . '/#/login';

    return '<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ihre Point4 Spin Zugangsdaten</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:Montserrat, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td align="center" style="padding:40px 20px;">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
                    <tr>
                        <td style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding:40px 40px 30px; text-align:center;">
                            <h1 style="color:#c9a05c; margin:0 0 10px; font-size:28px; font-weight:700;">Point4 Spin</h1>
                            <p style="color:#94a3b8; margin:0; font-size:14px;">Ihre Zugangsdaten</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:40px;">
                            <p style="color:#334155; font-size:16px; line-height:1.6; margin:0 0 24px;">
                                Hallo ' . htmlspecialchars($toName) . ',
                            </p>
                            <p style="color:#334155; font-size:16px; line-height:1.6; margin:0 0 32px;">
                                Ihr Konto für das Point4 Spin Glücksrad wurde erfolgreich eingerichtet. Sie können sich mit folgenden Zugangsdaten anmelden:
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc; border-radius:12px; margin-bottom:32px;">
                                <tr>
                                    <td style="padding:20px;">
                                        <p style="margin:0 0 8px; color:#64748b; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">E-Mail-Adresse</p>
                                        <p style="margin:0 0 20px; color:#0f172a; font-size:18px; font-weight:700;">' . htmlspecialchars($loginEmail) . '</p>
                                        <p style="margin:0 0 8px; color:#64748b; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Passwort</p>
                                        <p style="margin:0; color:#0f172a; font-size:18px; font-weight:700; font-family:monospace; letter-spacing:0.5px;">' . htmlspecialchars($plainPassword) . '</p>
                                    </td>
                                </tr>
                            </table>
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                                <tr>
                                    <td align="center">
                                        <a href="' . htmlspecialchars($loginUrl) . '" style="display:inline-block; padding:14px 32px; background:linear-gradient(135deg, #c9a05c 0%, #b08d4b 100%); color:#ffffff; text-decoration:none; border-radius:10px; font-weight:700; font-size:15px;">Zum Login</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 16px;">
                                Aus Sicherheitsgründen empfehlen wir Ihnen, das Passwort nach dem ersten Login unter „Passwort ändern“ zu ändern.
                            </p>
                            <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0;">
                                Bei Fragen stehen wir Ihnen gerne unter <a href="mailto:office@point4studio.at" style="color:#c9a05c;">office@point4studio.at</a> zur Verfügung.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:#f8fafc; padding:24px 40px; text-align:center; border-top:1px solid #e2e8f0;">
                            <p style="color:#94a3b8; font-size:12px; margin:0;">
                                © ' . date('Y') . ' Point4 Studios. Alle Rechte vorbehalten.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>';
}

function buildCredentialsEmailText($toName, $loginEmail, $plainPassword) {
    $loginUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') 
        . '://' . ($_SERVER['HTTP_HOST'] ?? 'spin.point4studios.at') . '/#/login';

    return "Hallo $toName,\n\n"
        . "Ihr Konto für das Point4 Spin Glücksrad wurde erfolgreich eingerichtet.\n\n"
        . "E-Mail-Adresse: $loginEmail\n"
        . "Passwort: $plainPassword\n\n"
        . "Login-URL: $loginUrl\n\n"
        . "Aus Sicherheitsgründen empfehlen wir Ihnen, das Passwort nach dem ersten Login zu ändern.\n\n"
        . "Bei Fragen stehen wir Ihnen gerne unter office@point4studio.at zur Verfügung.\n\n"
        . "© " . date('Y') . " Point4 Studios";
}
