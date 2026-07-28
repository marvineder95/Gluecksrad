<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

$DEFAULTS = [
    'total_spins_limit' => 1000,
    'campaign_status' => 'running',
    'estimated_spins' => '100',
    'primary_color' => '#1E3A8A',
    'secondary_color' => '#F6A7C4',
    'accent_color' => '#D4AF37',
    'font_family' => 'Montserrat',
    'label_font' => '',
    'hub_font' => '',
    'button_font' => '',
    'wheel_title' => 'Glücksrad',
    'win_badge_text' => 'GEWONNEN!',
    'win_button_text' => 'NÄCHSTE RUNDE',
    'win_default_text' => 'Herzlichen Glückwunsch!',
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
    'rim_enabled' => '1',
    'rim_style' => 'gold',
    'rim_color' => '#C8A866',
    'pointer_position' => 'top',
    'hub_color' => '#C8A866',
    'separator_color' => '#FFFFFF',
    'overlay_strength' => '30',
    'label_enabled' => '1',
    'label_color' => '#FFFFFF',
    'label_scale' => '1',
    'spin_button_text' => 'Drehen',
    'pointer_enabled' => '1',
    'pointer_color' => '#C8A866',
    'pointer_style' => 'triangle',
    'rim_glow' => '0',
    'segment_gap' => '0',
    'hub_enabled' => '1',
    'hub_type' => 'shape',
    'hub_shape' => 'circle',
    'hub_text' => '',
    'hub_text_color' => '#FFFFFF',
    'hub_text_layout' => 'straight',
    'hub_size' => '0.16',
    'segment_palette' => '',
    'background_mode' => 'theme',
    'background_color' => '#0F172A',
    'button_shape' => 'pill',
    'button_size' => '1',
    'button_color' => '#1E3A8A',
    'button_text_color' => '#FFFFFF',
    'button_position' => 'below',
    'wheel_borders' => '[{"fill":"gradient","c1":"#E8D5A3","c2":"#A68B4B","width":6,"glow":false}]'
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
    $textKeys = ['estimated_spins', 'primary_color', 'secondary_color', 'font_family', 'label_font',
                 'hub_font', 'button_font', 'wheel_title', 'win_badge_text',
                 'win_button_text', 'win_default_text',
                 'campaign_status', 'campaign_started_at', 'accent_color', 'theme',
                 'lead_capture_enabled', 'winner_email_enabled', 'winner_email_subject',
                 'winner_email_sender',
                 'segment_fill_mode', 'rim_enabled', 'rim_style', 'rim_color',
                 'pointer_position', 'hub_color',
                 'separator_color', 'separator_width', 'overlay_strength', 'label_enabled',
                 'label_color', 'label_scale', 'label_shadow', 'label_shadow_color',
                 'hub_content_scale', 'spin_button_text',
                 'pointer_enabled', 'pointer_color', 'pointer_style', 'rim_glow',
                 'segment_gap', 'hub_enabled', 'hub_type', 'hub_shape', 'hub_text',
                 'hub_text_color', 'hub_text_layout', 'hub_size', 'segment_palette', 'background_mode',
                 'background_color', 'button_shape', 'button_size', 'button_color',
                 'button_text_color', 'button_position'];
    $plainTextKeys = ['winner_email_body', 'wheel_borders', 'hub_text', 'saved_preset'];
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
