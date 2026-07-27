<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// GET /api/users - Liste aller Benutzer
if ($method === 'GET') {
    requireSuperAdmin();
    $stmt = $db->query("SELECT u.id, u.email, u.username, u.role, u.customer_id, u.is_active, u.created_at, u.last_login_at, c.company_name 
        FROM users u 
        LEFT JOIN customers c ON u.customer_id = c.id 
        ORDER BY u.created_at DESC");
    jsonResponse($stmt->fetchAll());
}

// POST /api/users - Neuen Benutzer anlegen
if ($method === 'POST') {
    requireSuperAdmin();
    validateCsrf();

    $action = $_GET['action'] ?? '';

    if ($action === 'reset_password') {
        // Passwort zurücksetzen
        $id = intval($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

        $data = json_decode(file_get_contents('php://input'), true);
        $newPassword = $data['password'] ?? '';
        if (strlen($newPassword) < 8) {
            jsonResponse(['error' => 'Passwort muss mindestens 8 Zeichen haben'], 400);
        }

        $hash = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->execute([$hash, $id]);

        jsonResponse(['success' => true, 'message' => 'Passwort zurückgesetzt']);
    }

    $data = json_decode(file_get_contents('php://input'), true);
    $email = trim($data['email'] ?? '');
    $role = $data['role'] ?? 'customer_admin';
    $customerId = isset($data['customer_id']) && $data['customer_id'] !== '' ? intval($data['customer_id']) : null;
    $password = $data['password'] ?? '';

    if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['error' => 'Gültige E-Mail ist erforderlich'], 400);
    }
    if (!in_array($role, ['super_admin', 'customer_admin'])) {
        jsonResponse(['error' => 'Ungültige Rolle'], 400);
    }
    if ($role === 'super_admin') {
        jsonResponse(['error' => 'Super Admin-Benutzer können nicht angelegt werden'], 403);
    }
    if ($role === 'customer_admin' && empty($customerId)) {
        jsonResponse(['error' => 'Kunden-Zuordnung ist für Kunden-Admin erforderlich'], 400);
    }
    if (strlen($password) < 8) {
        jsonResponse(['error' => 'Passwort muss mindestens 8 Zeichen haben'], 400);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $db->prepare("INSERT INTO users (email, username, password_hash, role, customer_id, is_active) VALUES (?, ?, ?, ?, ?, 1)");
    try {
        $stmt->execute([$email, $email, $hash, $role, $customerId]);
        $userId = $db->lastInsertId();
        jsonResponse(['success' => true, 'id' => $userId, 'message' => 'Benutzer angelegt']);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            jsonResponse(['error' => 'E-Mail wird bereits verwendet'], 409);
        }
        jsonResponse(['error' => 'Fehler beim Anlegen: ' . $e->getMessage()], 500);
    }
}

// PUT /api/users?id=... - Benutzer bearbeiten
if ($method === 'PUT') {
    requireSuperAdmin();
    validateCsrf();

    $id = intval($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

    $data = json_decode(file_get_contents('php://input'), true);
    $email = isset($data['email']) ? trim($data['email']) : null;
    $role = $data['role'] ?? null;
    $customerId = isset($data['customer_id']) && $data['customer_id'] !== '' ? intval($data['customer_id']) : null;
    $isActive = isset($data['is_active']) ? intval($data['is_active']) : null;

    $updates = [];
    $params = [];
    if ($email !== null) {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['error' => 'Ungültige E-Mail'], 400);
        }
        $updates[] = 'email = ?';
        $updates[] = 'username = ?';
        $params[] = $email;
        $params[] = $email;
    }
    if ($role !== null) {
        if (!in_array($role, ['super_admin', 'customer_admin'])) {
            jsonResponse(['error' => 'Ungültige Rolle'], 400);
        }
        if ($role === 'super_admin') {
            jsonResponse(['error' => 'Rolle kann nicht zu Super Admin geändert werden'], 403);
        }
        $updates[] = 'role = ?';
        $params[] = $role;
    }
    if (array_key_exists('customer_id', $data)) {
        $updates[] = 'customer_id = ?';
        $params[] = $customerId;
    }
    if ($isActive !== null) {
        // Super Admin-Konten können nicht deaktiviert werden
        $stmt = $db->prepare("SELECT role FROM users WHERE id = ?");
        $stmt->execute([$id]);
        $targetUser = $stmt->fetch();
        if ($targetUser && $targetUser['role'] === 'super_admin' && $isActive == 0) {
            jsonResponse(['error' => 'Super Admin-Benutzer können nicht deaktiviert werden'], 403);
        }
        $updates[] = 'is_active = ?';
        $params[] = $isActive;
    }

    if (empty($updates)) {
        jsonResponse(['error' => 'Keine Felder zum Aktualisieren'], 400);
    }

    $params[] = $id;
    $sql = "UPDATE users SET " . implode(', ', $updates) . " WHERE id = ?";
    try {
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(['success' => true, 'message' => 'Benutzer aktualisiert']);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            jsonResponse(['error' => 'E-Mail wird bereits verwendet'], 409);
        }
        jsonResponse(['error' => 'Fehler beim Aktualisieren: ' . $e->getMessage()], 500);
    }
}

// DELETE /api/users?id=... - Benutzer löschen
if ($method === 'DELETE') {
    requireSuperAdmin();
    validateCsrf();

    $id = intval($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

    // Super Admin-Konten können nicht gelöscht werden
    $stmt = $db->prepare("SELECT role FROM users WHERE id = ?");
    $stmt->execute([$id]);
    $targetUser = $stmt->fetch();
    if (!$targetUser) {
        jsonResponse(['error' => 'Benutzer nicht gefunden'], 404);
    }
    if ($targetUser['role'] === 'super_admin') {
        jsonResponse(['error' => 'Super Admin-Benutzer können nicht gelöscht werden'], 403);
    }

    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$id]);

    if ($stmt->rowCount() === 0) {
        jsonResponse(['error' => 'Benutzer nicht gefunden'], 404);
    }

    jsonResponse(['success' => true, 'message' => 'Benutzer gelöscht']);
}
