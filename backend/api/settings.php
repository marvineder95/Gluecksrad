<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

$DEFAULTS = [
    'total_spins_limit' => 1000,
    'campaign_status' => 'running',
    'primary_color' => '#1E3A8A',
    'secondary_color' => '#F6A7C4',
    'accent_color' => '#D4AF37',
    'font_family' => 'Montserrat',
    'wheel_title' => 'Glücksrad',
    'segment_color' => '#FF6B35',
    'segment_weight' => 100,
    'logo_fallback' => 'doveLogo.png',
    'theme' => 'dove',
    'lead_capture_enabled' => '0',
    'winner_email_enabled' => '0',
    'winner_email_subject' => 'Herzlichen Glückwunsch zu deinem Gewinn!',
    'winner_email_body' => "Hallo {{name}},\n\nherzlichen Glückwunsch! Du hast beim Glücksrad gewonnen: {{prize}}.\n\n{{win_text}}\n\nViel Freude damit!",
    'winner_email_sender' => 'noreply@point4spin.at',
    // Design-Tokens
    'segment_fill_mode' => 'image',
    'rim_style' => 'gold',
    'rim_color' => '#C8A866',
    'hub_color' => '#C8A866',
    'separator_color' => '#FFFFFF',
    'overlay_strength' => '30',
    'label_enabled' => '1',
    'label_color' => '#FFFFFF',
    'label_scale' => '1',
    'spin_button_text' => 'Drehen',
    'pointer_enabled' => '1',
    'pointer_color' => '#C8A866',
    'rim_glow' => '0',
    'segment_gap' => '0',
    'background_mode' => 'theme',
    'background_color' => '#0F172A'
];

// GET /api/settings - Einstellungen abrufen
if ($method === 'GET') {
    $customerId = getCurrentCustomerId();
    
    if ($customerId === null || $customerId <= 0) {
        // Super Admin ohne Kundenauswahl: leere Defaults liefern
        jsonResponse($DEFAULTS);
    }

    $stmt = $db->prepare("SELECT setting_key, setting_value FROM settings WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $settings = [];
    foreach ($stmt->fetchAll() as $row) {
        $settings[$row['setting_key']] = $row['setting_value'];
    }
    jsonResponse($settings);
}

// POST /api/settings - Einstellungen speichern
if ($method === 'POST') {
    requireCustomerAdmin();
    validateCsrf();

    $customerId = requireCustomerContext();
    $data = $_POST;

    // Text-Einstellungen
    $textKeys = ['primary_color', 'secondary_color', 'font_family', 'wheel_title',
                 'campaign_status', 'campaign_started_at', 'accent_color', 'theme',
                 'lead_capture_enabled', 'winner_email_enabled', 'winner_email_subject',
                 'winner_email_sender',
                 'segment_fill_mode', 'rim_style', 'rim_color', 'hub_color',
                 'separator_color', 'overlay_strength', 'label_enabled',
                 'label_color', 'label_scale', 'spin_button_text',
                 'pointer_enabled', 'pointer_color', 'rim_glow', 'segment_gap',
                 'background_mode', 'background_color'];
    $plainTextKeys = ['winner_email_body'];
    foreach ($textKeys as $key) {
        if (isset($data[$key])) {
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, ?, ?)");
            $stmt->execute([$customerId, $key, sanitizeText($data[$key])]);
        }
    }

    foreach ($plainTextKeys as $key) {
        if (isset($data[$key])) {
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, ?, ?)");
            $stmt->execute([$customerId, $key, sanitizePlainText($data[$key])]);
        }
    }

    // Datei-Uploads mit Validierung
    if (!empty($_FILES['logo']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) {
        $validation = validateImageUpload($_FILES['logo']);
        if (!$validation['valid']) {
            jsonResponse(['error' => $validation['error']], 400);
        }
        $logoDir = getCustomerUploadDir('logo');
        $filepath = $logoDir . $validation['safeName'];
        move_uploaded_file($_FILES['logo']['tmp_name'], $filepath);
        optimizeImage($filepath, $filepath, 400, 200, 90);
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'logo', ?)");
        $stmt->execute([$customerId, getCustomerUploadUrl('logo', $validation['safeName'])]);
    }

    if (!empty($_FILES['background_image']) && $_FILES['background_image']['error'] === UPLOAD_ERR_OK) {
        $validation = validateImageUpload($_FILES['background_image']);
        if (!$validation['valid']) {
            jsonResponse(['error' => $validation['error']], 400);
        }
        $bgDir = getCustomerUploadDir('background');
        $filepath = $bgDir . $validation['safeName'];
        move_uploaded_file($_FILES['background_image']['tmp_name'], $filepath);
        optimizeImage($filepath, $filepath, 1920, 1080, 85);
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'background_image', ?)");
        $stmt->execute([$customerId, getCustomerUploadUrl('background', $validation['safeName'])]);
    }

    jsonResponse(['success' => true]);
}
