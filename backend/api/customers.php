<?php
require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../utils/pool.php';
require_once __DIR__ . '/../utils/mailer.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

function createDefaultSegments($db, $customerId) {
    $defaults = [
        ['Hauptgewinn', '#FFD700', 1, 'gold'],
        ['Gewinn', '#4CAF50', 3, 'nature'],
        ['Trostpreis', '#2196F3', 5, 'water'],
        ['Nochmal drehen', '#FF9800', 3, 'sand'],
    ];
    $stmt = $db->prepare("INSERT INTO segments (customer_id, name, color, win_text, weight, sort_order, max_count, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    foreach ($defaults as $i => $seg) {
        $stmt->execute([$customerId, $seg[0], $seg[1], $seg[0], 100, $i, $seg[2], $seg[3]]);
    }
}

function createDefaultSettings($db, $customerId) {
    $defaults = [
        'primary_color' => '#1E3A8A',
        'secondary_color' => '#F6A7C4',
        'accent_color' => '#D4AF37',
        'font_family' => 'Montserrat',
        'wheel_title' => 'Glücksrad',
        'campaign_status' => 'running',
        'theme' => 'dove',
        'total_spins_limit' => '1000'
    ];
    $stmt = $db->prepare("INSERT OR IGNORE INTO settings (customer_id, setting_key, setting_value) VALUES (?, ?, ?)");
    foreach ($defaults as $key => $value) {
        $stmt->execute([$customerId, $key, $value]);
    }
}

// GET /api/customers - Liste aller Kunden
if ($method === 'GET') {
    requireSuperAdmin();
    $stmt = $db->query("
        SELECT 
            c.id, c.company_name, c.contact_name, c.email, c.logo, c.is_active, c.subdomain, c.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id) AS user_count,
            (SELECT COUNT(*) FROM spins s WHERE s.customer_id = c.id) AS spin_count
        FROM customers c
        ORDER BY c.company_name
    ");
    jsonResponse($stmt->fetchAll());
}

// POST /api/customers - Neuen Kunden anlegen
if ($method === 'POST') {
    requireSuperAdmin();
    validateCsrf();

    $data = json_decode(file_get_contents('php://input'), true);
    $companyName = sanitizePlainText($data['company_name'] ?? '');
    $contactName = sanitizePlainText($data['contact_name'] ?? '');
    $email = sanitizePlainText($data['email'] ?? '');
    $subdomain = sanitizePlainText($data['subdomain'] ?? '');

    if (empty($companyName)) {
        jsonResponse(['error' => 'Firmenname ist erforderlich'], 400);
    }
    if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['error' => 'Gültige E-Mail ist erforderlich'], 400);
    }

    // Explizite Prüfung, damit wir eine präzise Fehlermeldung zurückgeben können
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'E-Mail wird bereits verwendet'], 409);
    }

    if (!empty($subdomain)) {
        $stmt = $db->prepare("SELECT id FROM customers WHERE subdomain = ?");
        $stmt->execute([$subdomain]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Subdomain wird bereits verwendet'], 409);
        }
    }

    // Zufälliges 8-Zeichen Passwort für den automatischen Kunden-Admin generieren
    $plainPassword = substr(str_shuffle('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'), 0, 8);
    $passwordHash = password_hash($plainPassword, PASSWORD_BCRYPT);

    $db->beginTransaction();
    try {
        $stmt = $db->prepare("INSERT INTO customers (company_name, contact_name, email, subdomain, is_active) VALUES (?, ?, ?, ?, 1)");
        $stmt->execute([$companyName, $contactName, $email, $subdomain]);
        $customerId = $db->lastInsertId();

        createDefaultSegments($db, $customerId);
        createDefaultSettings($db, $customerId);
        generateSpinPool($db, $customerId);

        // Automatisch einen Admin-Benutzer für den Kunden anlegen
        $stmt = $db->prepare("INSERT INTO users (email, username, password_hash, role, customer_id, is_active) VALUES (?, ?, ?, 'customer_admin', ?, 1)");
        $stmt->execute([$email, $email, $passwordHash, $customerId]);

        $db->commit();

        // Zugangsdaten per E-Mail an den Kunden senden
        $mailResult = sendCustomerCredentials($email, $contactName ?: $companyName, $email, $plainPassword);

        jsonResponse([
            'success' => true,
            'id' => $customerId,
            'message' => 'Kunde angelegt',
            'email_sent' => $mailResult['success'],
            'email_error' => $mailResult['success'] ? null : $mailResult['error']
        ]);
    } catch (PDOException $e) {
        $db->rollBack();
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            jsonResponse(['error' => 'E-Mail oder Subdomain wird bereits verwendet', 'details' => $e->getMessage()], 409);
        }
        jsonResponse(['error' => 'Fehler beim Anlegen: ' . $e->getMessage()], 500);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Anlegen: ' . $e->getMessage()], 500);
    }
}

// PUT /api/customers?id=... - Kunde bearbeiten
if ($method === 'PUT') {
    requireSuperAdmin();
    validateCsrf();

    $id = intval($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

    $data = json_decode(file_get_contents('php://input'), true);
    $companyName = sanitizePlainText($data['company_name'] ?? '');
    $contactName = sanitizePlainText($data['contact_name'] ?? '');
    $email = sanitizePlainText($data['email'] ?? '');
    $subdomain = sanitizePlainText($data['subdomain'] ?? '');
    $isActive = isset($data['is_active']) ? intval($data['is_active']) : null;

    $updates = [];
    $params = [];
    if ($companyName !== '') { $updates[] = 'company_name = ?'; $params[] = $companyName; }
    if (isset($data['contact_name'])) { $updates[] = 'contact_name = ?'; $params[] = $contactName; }
    if (isset($data['email'])) { $updates[] = 'email = ?'; $params[] = $email; }
    if (isset($data['subdomain'])) { $updates[] = 'subdomain = ?'; $params[] = $subdomain; }
    if ($isActive !== null) { $updates[] = 'is_active = ?'; $params[] = $isActive; }

    if (empty($updates)) {
        jsonResponse(['error' => 'Keine Felder zum Aktualisieren'], 400);
    }

    $params[] = $id;
    $sql = "UPDATE customers SET " . implode(', ', $updates) . " WHERE id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    // E-Mail des automatischen Kunden-Admin-Benutzers synchronisieren
    if (isset($data['email'])) {
        $stmt = $db->prepare("UPDATE users SET email = ?, username = ? WHERE customer_id = ? AND role = 'customer_admin'");
        $stmt->execute([$email, $email, $id]);
    }

    jsonResponse(['success' => true, 'message' => 'Kunde aktualisiert']);
}

// DELETE /api/customers?id=... - Kunde löschen
if ($method === 'DELETE') {
    requireSuperAdmin();
    validateCsrf();

    $id = intval($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

    $db->beginTransaction();
    try {
        // Abhängige Daten in korrekter Reihenfolge löschen (Foreign Keys)
        $tables = ['spin_pool', 'spins', 'segments', 'settings', 'campaign_archives', 'users'];
        foreach ($tables as $table) {
            $stmt = $db->prepare("DELETE FROM {$table} WHERE customer_id = ?");
            $stmt->execute([$id]);
        }

        $stmt = $db->prepare("DELETE FROM customers WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            $db->rollBack();
            jsonResponse(['error' => 'Kunde nicht gefunden'], 404);
        }

        $db->commit();
        jsonResponse(['success' => true, 'message' => 'Kunde gelöscht']);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Löschen: ' . $e->getMessage()], 500);
    }
}
