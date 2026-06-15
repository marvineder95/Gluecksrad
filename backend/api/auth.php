<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $username = trim($data['username'] ?? '');
    $password = $data['password'] ?? '';

    if (empty($username) || empty($password)) {
        jsonResponse(['error' => 'Benutzername und Passwort erforderlich'], 400);
    }

    // Rate-Limiting nach IP + Username
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $rateKey = 'login:' . $clientIp . ':' . $username;
    checkRateLimit($rateKey, 5, 300);

    $stmt = $db->prepare("SELECT id, username, password_hash FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        session_start();
        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_id'] = $user['id'];
        $_SESSION['admin_username'] = $user['username'];
        
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

        // Rate-Limit zurücksetzen bei Erfolg
        resetRateLimit($rateKey);

        jsonResponse([
            'success' => true,
            'token' => $token,
            'csrf_token' => $csrfToken,
            'user' => ['username' => $user['username']]
        ]);
    } else {
        jsonResponse(['error' => 'Ungültige Anmeldedaten'], 401);
    }
}

if ($method === 'GET') {
    session_start();
    $sessionValid = !empty($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true;
    
    if ($sessionValid) {
        $csrfToken = $_SESSION['csrf_token'] ?? '';
        jsonResponse([
            'authenticated' => true,
            'user' => ['username' => $_SESSION['admin_username'] ?? 'admin'],
            'csrf_token' => $csrfToken
        ]);
    }
    
    // Bearer Token prüfen
    $authHeader = getRequestHeader('Authorization');
    $token = str_replace('Bearer ', '', $authHeader);
    
    if (!empty($token)) {
        $stmt = $db->prepare("SELECT username FROM users WHERE api_token = ?");
        $stmt->execute([$token]);
        $user = $stmt->fetch();
        if ($user) {
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_username'] = $user['username'];
            // Neuen CSRF-Token generieren, falls nicht vorhanden
            $csrfToken = $_SESSION['csrf_token'] ?? '';
            if (empty($csrfToken)) {
                $csrfToken = bin2hex(random_bytes(32));
                $_SESSION['csrf_token'] = $csrfToken;
            }
            jsonResponse([
                'authenticated' => true,
                'user' => ['username' => $user['username']],
                'csrf_token' => $csrfToken
            ]);
        }
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
    $userId = $_SESSION['admin_id'] ?? 0;
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

    $userId = $_SESSION['admin_id'] ?? 0;
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
