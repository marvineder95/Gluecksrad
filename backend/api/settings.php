<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// GET /api/settings - Einstellungen abrufen
if ($method === 'GET') {
    $stmt = $db->query("SELECT setting_key, setting_value FROM settings");
    $settings = [];
    foreach ($stmt->fetchAll() as $row) {
        $settings[$row['setting_key']] = $row['setting_value'];
    }
    jsonResponse($settings);
}

// POST /api/settings - Einstellungen speichern
if ($method === 'POST') {
    requireAuth();
    validateCsrf();

    $data = $_POST;

    // Text-Einstellungen
    $textKeys = ['primary_color', 'secondary_color', 'font_family', 'wheel_title',
                 'campaign_status', 'campaign_started_at', 'accent_color', 'theme'];
    foreach ($textKeys as $key) {
        if (isset($data[$key])) {
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES (?, ?)");
            $stmt->execute([$key, sanitizeText($data[$key])]);
        }
    }

    // Datei-Uploads mit Validierung
    $uploadDir = __DIR__ . '/../uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    if (!empty($_FILES['logo']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) {
        $validation = validateImageUpload($_FILES['logo']);
        if (!$validation['valid']) {
            jsonResponse(['error' => $validation['error']], 400);
        }
        $logoDir = $uploadDir . 'logo/';
        if (!is_dir($logoDir)) mkdir($logoDir, 0755, true);
        $filepath = $logoDir . $validation['safeName'];
        move_uploaded_file($_FILES['logo']['tmp_name'], $filepath);
        optimizeImage($filepath, $filepath, 400, 200, 90);
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('logo', ?)");
        $stmt->execute(['backend/uploads/logo/' . $validation['safeName']]);
    }

    if (!empty($_FILES['background_image']) && $_FILES['background_image']['error'] === UPLOAD_ERR_OK) {
        $validation = validateImageUpload($_FILES['background_image']);
        if (!$validation['valid']) {
            jsonResponse(['error' => $validation['error']], 400);
        }
        $bgDir = $uploadDir . 'background/';
        if (!is_dir($bgDir)) mkdir($bgDir, 0755, true);
        $filepath = $bgDir . $validation['safeName'];
        move_uploaded_file($_FILES['background_image']['tmp_name'], $filepath);
        optimizeImage($filepath, $filepath, 1920, 1080, 85);
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('background_image', ?)");
        $stmt->execute(['backend/uploads/background/' . $validation['safeName']]);
    }

    jsonResponse(['success' => true]);
}
