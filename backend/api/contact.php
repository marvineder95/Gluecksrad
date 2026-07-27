<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
    jsonResponse(['error' => 'Methode nicht erlaubt'], 405);
}

$data = json_decode(file_get_contents('php://input'), true);

$name = sanitizePlainText($data['name'] ?? '');
$company = sanitizePlainText($data['company'] ?? '');
$email = filter_var(trim($data['email'] ?? ''), FILTER_VALIDATE_EMAIL);
$phone = sanitizePlainText($data['phone'] ?? '');
$eventDate = sanitizePlainText($data['event_date'] ?? '');
$message = sanitizePlainText($data['message'] ?? '');
$copyToSender = !empty($data['copy_to_sender']);
$privacyConsent = !empty($data['privacy_consent']);

if (empty($name)) {
    jsonResponse(['error' => 'Name ist erforderlich'], 400);
}
if (empty($email)) {
    jsonResponse(['error' => 'Gültige E-Mail-Adresse ist erforderlich'], 400);
}
if (empty($message)) {
    jsonResponse(['error' => 'Nachricht ist erforderlich'], 400);
}
if (!$privacyConsent) {
    jsonResponse(['error' => 'Datenschutz-Einwilligung ist erforderlich'], 400);
}

$clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
checkRateLimit('contact:' . $clientIp, 3, 60);

$to = 'hello@point4studios.at';
$subject = 'Neue Demo-Anfrage über Point4 Spin – ' . $name;

$bodyHtml = "<html><body style='font-family: Montserrat, Arial, sans-serif; color: #0b155d;'>";
$bodyHtml .= "<h2 style='color: #c9a05c;'>Neue Demo-Anfrage über Point4 Spin</h2>";
$bodyHtml .= "<table cellpadding='6' style='border-collapse: collapse;'>";
$bodyHtml .= "<tr><td><strong>Name:</strong></td><td>" . htmlspecialchars($name) . "</td></tr>";
if ($company) {
    $bodyHtml .= "<tr><td><strong>Firma:</strong></td><td>" . htmlspecialchars($company) . "</td></tr>";
}
$bodyHtml .= "<tr><td><strong>E-Mail:</strong></td><td>" . htmlspecialchars($email) . "</td></tr>";
if ($phone) {
    $bodyHtml .= "<tr><td><strong>Telefon:</strong></td><td>" . htmlspecialchars($phone) . "</td></tr>";
}
if ($eventDate) {
    $bodyHtml .= "<tr><td><strong>Event-Datum:</strong></td><td>" . htmlspecialchars($eventDate) . "</td></tr>";
}
$bodyHtml .= "</table>";
$bodyHtml .= "<p style='margin-top: 20px;'><strong>Nachricht:</strong></p>";
$bodyHtml .= "<p style='white-space: pre-line; background: #f8f9fc; padding: 16px; border-radius: 8px; border-left: 3px solid #c9a05c;'>" . nl2br(htmlspecialchars($message)) . "</p>";
$bodyHtml .= "<p style='margin-top: 24px; font-size: 12px; color: #6b7280;'>Gesendet von IP: " . htmlspecialchars($clientIp) . " am " . date('d.m.Y H:i:s') . "</p>";
$bodyHtml .= "</body></html>";

$bodyPlain = "Neue Demo-Anfrage über Point4 Spin\n\n";
$bodyPlain .= "Name: " . $name . "\n";
if ($company) {
    $bodyPlain .= "Firma: " . $company . "\n";
}
$bodyPlain .= "E-Mail: " . $email . "\n";
if ($phone) {
    $bodyPlain .= "Telefon: " . $phone . "\n";
}
if ($eventDate) {
    $bodyPlain .= "Event-Datum: " . $eventDate . "\n";
}
$bodyPlain .= "\nNachricht:\n" . $message . "\n\n";
$bodyPlain .= "Gesendet von IP: " . $clientIp . " am " . date('d.m.Y H:i:s');

$boundary = md5(time());
$headers = "From: Point4 Spin <noreply@point4spin.at>\r\n";
$headers .= "Reply-To: " . $email . "\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"" . $boundary . "\"\r\n";

$fullBody = "--" . $boundary . "\r\n";
$fullBody .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
$fullBody .= $bodyPlain . "\r\n\r\n";
$fullBody .= "--" . $boundary . "\r\n";
$fullBody .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
$fullBody .= $bodyHtml . "\r\n\r\n";
$fullBody .= "--" . $boundary . "--";

$sentToAdmin = mail($to, $subject, $fullBody, $headers);

$sentToSender = false;
if ($copyToSender) {
    $senderSubject = 'Ihre Demo-Anfrage bei Point4 Spin';
    $senderHtml = "<html><body style='font-family: Montserrat, Arial, sans-serif; color: #0b155d;'>";
    $senderHtml .= "<h2 style='color: #c9a05c;'>Vielen Dank für Ihre Anfrage!</h2>";
    $senderHtml .= "<p>Hallo " . htmlspecialchars($name) . ",</p>";
    $senderHtml .= "<p>wir haben Ihre Demo-Anfrage für Point4 Spin erhalten und melden uns so schnell wie möglich bei Ihnen.</p>";
    $senderHtml .= "<p style='margin-top: 20px;'><strong>Ihre Angaben:</strong></p>";
    $senderHtml .= "<table cellpadding='6' style='border-collapse: collapse;'>";
    $senderHtml .= "<tr><td><strong>Name:</strong></td><td>" . htmlspecialchars($name) . "</td></tr>";
    if ($company) {
        $senderHtml .= "<tr><td><strong>Firma:</strong></td><td>" . htmlspecialchars($company) . "</td></tr>";
    }
    $senderHtml .= "<tr><td><strong>E-Mail:</strong></td><td>" . htmlspecialchars($email) . "</td></tr>";
    if ($phone) {
        $senderHtml .= "<tr><td><strong>Telefon:</strong></td><td>" . htmlspecialchars($phone) . "</td></tr>";
    }
    if ($eventDate) {
        $senderHtml .= "<tr><td><strong>Event-Datum:</strong></td><td>" . htmlspecialchars($eventDate) . "</td></tr>";
    }
    $senderHtml .= "</table>";
    $senderHtml .= "<p style='margin-top: 20px;'><strong>Ihre Nachricht:</strong></p>";
    $senderHtml .= "<p style='white-space: pre-line; background: #f8f9fc; padding: 16px; border-radius: 8px; border-left: 3px solid #c9a05c;'>" . nl2br(htmlspecialchars($message)) . "</p>";
    $senderHtml .= "<p style='margin-top: 24px;'>Mit freundlichen Grüßen<br>Ihr Point4 Spin Team</p>";
    $senderHtml .= "<p style='font-size: 12px; color: #6b7280;'>Point4 Studios | hello@point4studios.at | <a href='https://point4studio.at'>point4studio.at</a></p>";
    $senderHtml .= "</body></html>";

    $senderPlain = "Vielen Dank für Ihre Anfrage!\n\n";
    $senderPlain .= "Hallo " . $name . ",\n\n";
    $senderPlain .= "wir haben Ihre Demo-Anfrage für Point4 Spin erhalten und melden uns so schnell wie möglich bei Ihnen.\n\n";
    $senderPlain .= "Ihre Nachricht:\n" . $message . "\n\n";
    $senderPlain .= "Mit freundlichen Grüßen\nIhr Point4 Spin Team\n\n";
    $senderPlain .= "Point4 Studios | hello@point4studios.at | point4studio.at";

    $senderBoundary = md5(time() . 'sender');
    $senderHeaders = "From: Point4 Spin <noreply@point4spin.at>\r\n";
    $senderHeaders .= "MIME-Version: 1.0\r\n";
    $senderHeaders .= "Content-Type: multipart/alternative; boundary=\"" . $senderBoundary . "\"\r\n";

    $senderFullBody = "--" . $senderBoundary . "\r\n";
    $senderFullBody .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
    $senderFullBody .= $senderPlain . "\r\n\r\n";
    $senderFullBody .= "--" . $senderBoundary . "\r\n";
    $senderFullBody .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
    $senderFullBody .= $senderHtml . "\r\n\r\n";
    $senderFullBody .= "--" . $senderBoundary . "--";

    $sentToSender = mail($email, $senderSubject, $senderFullBody, $senderHeaders);
}

$logDir = __DIR__ . '/../logs';
@mkdir($logDir, 0755, true);
$logEntry = date('Y-m-d H:i:s') . " | Contact Form | From: " . $email . " | To Admin: " . ($sentToAdmin ? 'YES' : 'NO') . " | Copy to Sender: " . ($sentToSender ? 'YES' : ($copyToSender ? 'FAILED' : 'not requested')) . "\n";
file_put_contents($logDir . '/mail.log', $logEntry, FILE_APPEND);

if (!$sentToAdmin) {
    jsonResponse(['error' => 'E-Mail konnte nicht versendet werden. Bitte versuchen Sie es später erneut.'], 500);
}

jsonResponse(['success' => true, 'copy_sent' => $sentToSender]);
