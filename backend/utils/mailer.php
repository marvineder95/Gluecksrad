<?php
require_once __DIR__ . '/../vendor/phpmailer/PHPMailer.php';
require_once __DIR__ . '/../vendor/phpmailer/SMTP.php';
require_once __DIR__ . '/../vendor/phpmailer/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

function getEmailConfig() {
    return require __DIR__ . '/../config/email.php';
}

function sendCustomerCredentials($toEmail, $toName, $loginEmail, $plainPassword) {
    $config = getEmailConfig();

    $mail = new PHPMailer(true);
    $mail->CharSet = 'UTF-8';
    $mail->Encoding = 'base64';

    try {
        // Server settings
        $mail->isSMTP();
        $mail->Host = $config['smtp_host'];
        $mail->SMTPAuth = $config['smtp_auth'];
        $mail->Username = $config['smtp_username'];
        $mail->Password = $config['smtp_password'];
        $mail->SMTPSecure = $config['smtp_secure'];
        $mail->Port = $config['smtp_port'];
        $mail->SMTPDebug = $config['debug'];

        // Absender
        $mail->setFrom($config['from_email'], $config['from_name']);
        if (!empty($config['reply_to_email'])) {
            $mail->addReplyTo($config['reply_to_email'], $config['reply_to_name']);
        }

        // Empfänger
        $mail->addAddress($toEmail, $toName);

        // Inhalt
        $mail->isHTML(true);
        $mail->Subject = 'Ihre Zugangsdaten für Point4 Spin';
        $mail->Body = buildCredentialsEmailHtml($toName, $loginEmail, $plainPassword);
        $mail->AltBody = buildCredentialsEmailText($toName, $loginEmail, $plainPassword);

        $mail->send();
        return ['success' => true];
    } catch (PHPMailerException $e) {
        return ['success' => false, 'error' => $mail->ErrorInfo];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    }
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
