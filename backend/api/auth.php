<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $email = trim($data['email'] ?? '');
    $password = $data['password'] ?? '';

    if (empty($email) || empty($password)) {
        jsonResponse(['error' => 'E-Mail und Passwort erforderlich'], 400);
    }

    // Rate-Limiting nach IP + E-Mail
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $rateKey = 'login:' . $clientIp . ':' . $email;
    checkRateLimit($rateKey, 5, 300);

    $stmt = $db->prepare("SELECT id, email, role, customer_id, password_hash, is_active FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || empty($user['is_active'])) {
        jsonResponse(['error' => 'Ungültige Anmeldedaten'], 401);
    }

    if (!password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Ungültige Anmeldedaten'], 401);
    }

    session_start();
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_email'] = $user['email'];
    $_SESSION['user_role'] = $user['role'];
    $_SESSION['customer_id'] = $user['customer_id'];

    // Session-ID regenerieren gegen Session Fixation
    session_regenerate_id(true);

    // Sicheren API-Token generieren (nicht session_id) mit Ablaufzeit
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', strtotime('+30 days'));
    $_SESSION['api_token'] = $token;
    $_SESSION['api_token_expires_at'] = $expiresAt;
    $stmt = $db->prepare("UPDATE users SET api_token = ?, api_token_expires_at = ? WHERE id = ?");
    $stmt->execute([$token, $expiresAt, $user['id']]);

    // CSRF-Token generieren
    $csrfToken = bin2hex(random_bytes(32));
    $_SESSION['csrf_token'] = $csrfToken;

    // Letzten Login-Zeitpunkt aktualisieren
    $stmt = $db->prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?");
    $stmt->execute([$user['id']]);

    // Rate-Limit zurücksetzen bei Erfolg
    resetRateLimit($rateKey);

    jsonResponse([
        'success' => true,
        'token' => $token,
        'csrf_token' => $csrfToken,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'role' => $user['role'],
            'customer_id' => $user['customer_id']
        ]
    ]);
}

if ($method === 'GET') {
    session_start();
    $sessionValid = !empty($_SESSION['user_id']) && !empty($_SESSION['user_role']);

    if ($sessionValid) {
        $csrfToken = $_SESSION['csrf_token'] ?? '';
        jsonResponse([
            'authenticated' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'email' => $_SESSION['user_email'],
                'role' => $_SESSION['user_role'],
                'customer_id' => $_SESSION['customer_id']
            ],
            'csrf_token' => $csrfToken
        ]);
    }

    // Bearer Token prüfen
    $authHeader = getRequestHeader('Authorization');
    $token = str_replace('Bearer ', '', $authHeader);

    if (!empty($token) && loadUserSessionFromToken($token)) {
        $csrfToken = $_SESSION['csrf_token'] ?? '';
        if (empty($csrfToken)) {
            $csrfToken = bin2hex(random_bytes(32));
            $_SESSION['csrf_token'] = $csrfToken;
        }
        jsonResponse([
            'authenticated' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'email' => $_SESSION['user_email'],
                'role' => $_SESSION['user_role'],
                'customer_id' => $_SESSION['customer_id']
            ],
            'csrf_token' => $csrfToken
        ]);
    }

    jsonResponse(['authenticated' => false], 401);
}

if ($method === 'DELETE') {
    session_start();
    validateCsrf();
    $token = $_SESSION['api_token'] ?? '';
    if ($token) {
        $stmt = $db->prepare("UPDATE users SET api_token = NULL WHERE api_token = ?");
        $stmt->execute([$token]);
    }
    // Auch alle anderen Tokens des gleichen Users invalidieren
    $userId = $_SESSION['user_id'] ?? 0;
    if ($userId) {
        $stmt = $db->prepare("UPDATE users SET api_token = NULL WHERE id = ?");
        $stmt->execute([$userId]);
    }
    session_destroy();
    jsonResponse(['success' => true]);
}

// PUT /api/auth - Passwort ändern
if ($method === 'PUT') {
    requireAuth();
    validateCsrf();

    $data = json_decode(file_get_contents('php://input'), true);
    $currentPassword = $data['current_password'] ?? '';
    $newPassword = $data['new_password'] ?? '';

    if (empty($currentPassword) || empty($newPassword)) {
        jsonResponse(['error' => 'Aktuelles und neues Passwort erforderlich'], 400);
    }

    if (strlen($newPassword) < 8) {
        jsonResponse(['error' => 'Neues Passwort muss mindestens 8 Zeichen haben'], 400);
    }

    $userId = getCurrentUserId();
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
        jsonResponse(['error' => 'Aktuelles Passwort ist falsch'], 401);
    }

    $newHash = password_hash($newPassword, PASSWORD_BCRYPT);
    $stmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    $stmt->execute([$newHash, $userId]);

    jsonResponse(['success' => true, 'message' => 'Passwort erfolgreich geändert']);
}

// PATCH /api/auth - E-Mail ändern
if ($method === 'PATCH') {
    requireAuth();
    validateCsrf();

    $data = json_decode(file_get_contents('php://input'), true);
    $newEmail = trim($data['email'] ?? '');

    if (empty($newEmail) || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['error' => 'Gültige E-Mail-Adresse erforderlich'], 400);
    }

    $userId = getCurrentUserId();

    // Prüfen, ob E-Mail bereits vergeben
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
    $stmt->execute([$newEmail, $userId]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'E-Mail wird bereits verwendet'], 409);
    }

    $stmt = $db->prepare("UPDATE users SET email = ? WHERE id = ?");
    $stmt->execute([$newEmail, $userId]);

    // Session aktualisieren
    $_SESSION['user_email'] = $newEmail;

    jsonResponse(['success' => true, 'message' => 'E-Mail erfolgreich geändert', 'email' => $newEmail]);
}
