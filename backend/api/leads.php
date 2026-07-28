<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();
$customerId = getCurrentCustomerId();

if ($customerId === null || $customerId <= 0) {
    jsonResponse(['error' => 'Kundenkontext erforderlich'], 400);
}

// GET /api/leads - Leads abrufen (nur für authentifizierte Admins)
if ($method === 'GET') {
    requireCustomerAdmin();

    $stmt = $db->prepare("SELECT id, name, email, spin_id, prize, consent_given, data, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC");
    $stmt->execute([$customerId]);
    $leads = $stmt->fetchAll();

    jsonResponse($leads);
}

// POST /api/leads - Neuen Lead speichern (öffentlich, aber rate-limited)
if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $name = sanitizePlainText($data['name'] ?? '');
    $email = filter_var(trim($data['email'] ?? ''), FILTER_VALIDATE_EMAIL);
    $consentGiven = !empty($data['consent_given']) ? 1 : 0;

    // Zusätzliche konfigurierbare Lead-Felder als JSON
    $extraData = null;
    if (isset($data['data']) && is_array($data['data']) && count($data['data']) > 0) {
        $clean = [];
        foreach ($data['data'] as $k => $v) {
            $clean[sanitizePlainText((string)$k)] = sanitizePlainText((string)$v);
        }
        $extraData = json_encode($clean, JSON_UNESCAPED_UNICODE);
    }

    if (empty($name)) {
        jsonResponse(['error' => 'Name ist erforderlich'], 400);
    }
    if (empty($email)) {
        jsonResponse(['error' => 'Gültige E-Mail-Adresse ist erforderlich'], 400);
    }
    if (!$consentGiven) {
        jsonResponse(['error' => 'Einwilligung erforderlich'], 400);
    }

    // Rate-Limiting: max. 10 Leads pro Minute pro IP
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    checkRateLimit('lead:' . $clientIp, 10, 60);

    $stmt = $db->prepare("INSERT INTO leads (customer_id, name, email, consent_given, data) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$customerId, $name, $email, $consentGiven, $extraData]);
    $leadId = $db->lastInsertId();

    jsonResponse(['success' => true, 'id' => intval($leadId)]);
}

jsonResponse(['error' => 'Methode nicht erlaubt'], 405);
