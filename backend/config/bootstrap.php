<?php
// Bootstrap: HTTP-Setup, CORS, Auth, Rate-Limiting, JSON-Response
require_once __DIR__ . '/database.php';

// Suppress PHP warnings/notices in output (they break JSON responses)
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', '0');

// === Header-Hilfsfunktion (CGI/FastCGI kompatibel) ===
// getallheaders() ist unter CGI/FastCGI (z.B. World4you) oft nicht verfügbar
// oder liefert leere Werte. Daher lesen wir die benötigten Header direkt aus $_SERVER.
function getRequestHeader($headerName) {
    // 1. Versuch: Apache-Funktion (mod_php)
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers) && !empty($headers)) {
            // Case-insensitive Suche
            foreach ($headers as $name => $value) {
                if (strcasecmp($name, $headerName) === 0) {
                    return $value;
                }
            }
        }
    }

    // 2. Versuch: Aus $_SERVER auslesen
    $serverName = 'HTTP_' . strtoupper(str_replace('-', '_', $headerName));
    if (!empty($_SERVER[$serverName])) {
        return $_SERVER[$serverName];
    }

    // Spezialfälle
    if (strcasecmp($headerName, 'Content-Type') === 0 && !empty($_SERVER['CONTENT_TYPE'])) {
        return $_SERVER['CONTENT_TYPE'];
    }
    if (strcasecmp($headerName, 'Content-Length') === 0 && !empty($_SERVER['CONTENT_LENGTH'])) {
        return $_SERVER['CONTENT_LENGTH'];
    }

    return '';
}

// Increase upload limits for product images
ini_set('upload_max_filesize', '20M');
ini_set('post_max_size', '25M');
ini_set('max_execution_time', '120');
ini_set('memory_limit', '512M');

// Sichere Session-Cookie-Einstellungen (vor jedem session_start())
// Rückwärtskompatibel zu PHP < 7.3 (Array-Parameter mit samesite erst ab 7.3)
$isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
if (PHP_VERSION_ID >= 70300) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
} else {
    session_set_cookie_params(0, '/', '', $isHttps, true);
}

// === CORS – erlaubte Origins ===
$allowedOrigins = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost',
    'http://127.0.0.1',
    'https://spin.point4studios.at',
    'http://spin.point4studios.at'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowedOrigins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
}
// Bei unbekanntem/leerem Origin werden keine CORS-Header gesetzt

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');

// Content-Security-Policy gegen XSS
$nonce = bin2hex(random_bytes(16));
header("Content-Security-Policy: default-src 'self'; script-src 'self' https://unpkg.com 'nonce-$nonce'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';");

// HSTS nur bei HTTPS (Produktion)
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// === JSON-Response ===
function jsonResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// === Auth: Session ODER Bearer Token ===
function loadUserSessionFromToken($token) {
    $db = getDB();
    $stmt = $db->prepare("SELECT id, email, role, customer_id, api_token_expires_at, is_active FROM users WHERE api_token = ?");
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) return false;
    if (empty($user['is_active'])) {
        return false;
    }
    $expiresAt = $user['api_token_expires_at'] ?? null;
    if ($expiresAt && strtotime($expiresAt) < time()) {
        $stmt = $db->prepare("UPDATE users SET api_token = NULL, api_token_expires_at = NULL WHERE id = ?");
        $stmt->execute([$user['id']]);
        return false;
    }
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_email'] = $user['email'];
    $_SESSION['user_role'] = $user['role'];
    $_SESSION['customer_id'] = $user['customer_id'];
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return true;
}

function requireAuth() {
    session_start();
    $sessionValid = !empty($_SESSION['user_id']) && !empty($_SESSION['user_role']);

    if ($sessionValid) {
        return true;
    }

    // Bearer Token prüfen
    $authHeader = getRequestHeader('Authorization');
    $token = str_replace('Bearer ', '', $authHeader);

    if (!empty($token) && loadUserSessionFromToken($token)) {
        return true;
    }

    jsonResponse(['error' => 'Nicht autorisiert'], 401);
}

function requireSuperAdmin() {
    requireAuth();
    if ($_SESSION['user_role'] !== 'super_admin') {
        jsonResponse(['error' => 'Zugriff verweigert'], 403);
    }
}

function requireCustomerAdmin() {
    requireAuth();
    if ($_SESSION['user_role'] !== 'customer_admin' && $_SESSION['user_role'] !== 'super_admin') {
        jsonResponse(['error' => 'Zugriff verweigert'], 403);
    }
    if ($_SESSION['user_role'] === 'customer_admin' && empty($_SESSION['customer_id'])) {
        jsonResponse(['error' => 'Kunde nicht zugeordnet'], 403);
    }
}

function getCurrentUserId() {
    return intval($_SESSION['user_id'] ?? 0);
}

function getCurrentUserEmail() {
    return $_SESSION['user_email'] ?? '';
}

function getCurrentRole() {
    return $_SESSION['user_role'] ?? '';
}

function getCurrentCustomerId() {
    session_start();
    $role = getCurrentRole();

    if ($role === 'super_admin') {
        // Super Admin kann optional einen Kunden auswählen
        $requestedCustomerId = intval($_GET['customer_id'] ?? 0);
        if ($requestedCustomerId > 0) {
            return $requestedCustomerId;
        }
        return null;
    }

    if (!empty($_SESSION['customer_id'])) {
        return intval($_SESSION['customer_id']);
    }

    // Öffentliche Endpunkte (z.B. Eventmodus) können Kunden per Query-Parameter wählen
    $publicCustomerId = intval($_GET['customer_id'] ?? 0);
    if ($publicCustomerId > 0) {
        return $publicCustomerId;
    }

    // Fallback: Default-Kunde
    return 1;
}

function isSuperAdmin() {
    return getCurrentRole() === 'super_admin';
}

/**
 * Liefert SQL WHERE-Fragment und Parameter für Mandantenfilter.
 * Beispiel: list($where, $params) = getCustomerFilter('s');
 * WHERE $where -> "s.customer_id = ?"
 */
function getCustomerFilter($tableAlias = '') {
    $customerId = getCurrentCustomerId();
    $prefix = $tableAlias ? $tableAlias . '.' : '';
    if ($customerId === null) {
        // Super Admin ohne Kundenauswahl: kein Filter
        return ['1=1', []];
    }
    return [$prefix . 'customer_id = ?', [$customerId]];
}

/**
 * Fügt Mandantenfilter zu einer bestehenden WHERE-Bedingung hinzu.
 */
function addCustomerFilter(&$where, &$params, $tableAlias = '') {
    list($filterSql, $filterParams) = getCustomerFilter($tableAlias);
    if ($filterSql !== '1=1') {
        $where = $where ? "($where) AND $filterSql" : $filterSql;
        $params = array_merge($params, $filterParams);
    }
}

function requireCustomerContext() {
    $customerId = getCurrentCustomerId();
    if ($customerId === null || $customerId <= 0) {
        jsonResponse(['error' => 'Kundenkontext erforderlich'], 400);
    }
    return $customerId;
}

function getCustomerUploadDir($type) {
    $customerId = requireCustomerContext();
    $dir = __DIR__ . '/../uploads/customer_' . $customerId . '/' . $type . '/';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function getCustomerUploadUrl($type, $filename) {
    $customerId = getCurrentCustomerId();
    if ($customerId === null || $customerId <= 0) {
        return '';
    }
    return 'backend/uploads/customer_' . $customerId . '/' . $type . '/' . $filename;
}

// === CSRF-Token Validierung ===
function validateCsrf() {
    session_start();
    $csrfHeader = getRequestHeader('X-CSRF-Token');
    $sessionToken = $_SESSION['csrf_token'] ?? '';

    if (empty($sessionToken)) {
        jsonResponse(['error' => 'CSRF-Token fehlt in der Session. Bitte erneut anmelden.'], 403);
    }
    if (empty($csrfHeader)) {
        jsonResponse(['error' => 'CSRF-Token Header fehlt.'], 403);
    }
    if (!hash_equals($sessionToken, $csrfHeader)) {
        jsonResponse(['error' => 'Ungültiges CSRF-Token'], 403);
    }
}

// === Rate-Limiting für Login ===
function checkRateLimit($identifier, $maxAttempts = 5, $windowSeconds = 300) {
    $db = getDB();
    $db->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        identifier TEXT PRIMARY KEY,
        attempts INTEGER DEFAULT 0,
        first_attempt INTEGER,
        last_attempt INTEGER
    )");

    $now = time();
    $stmt = $db->prepare("SELECT * FROM rate_limits WHERE identifier = ?");
    $stmt->execute([$identifier]);
    $row = $stmt->fetch();

    if ($row) {
        // Fenster abgelaufen? -> zurücksetzen
        if ($now - intval($row['first_attempt']) > $windowSeconds) {
            $stmt = $db->prepare("UPDATE rate_limits SET attempts = 1, first_attempt = ?, last_attempt = ? WHERE identifier = ?");
            $stmt->execute([$now, $now, $identifier]);
            return true;
        }

        // Limit erreicht?
        if (intval($row['attempts']) >= $maxAttempts) {
            $remaining = $windowSeconds - ($now - intval($row['first_attempt']));
            jsonResponse([
                'error' => 'Zu viele Anmeldeversuche. Bitte versuchen Sie es in ' . ceil($remaining / 60) . ' Minuten erneut.'
            ], 429);
        }

        // Versuch zählen
        $stmt = $db->prepare("UPDATE rate_limits SET attempts = attempts + 1, last_attempt = ? WHERE identifier = ?");
        $stmt->execute([$now, $identifier]);
        return true;
    }

    // Erster Versuch
    $stmt = $db->prepare("INSERT INTO rate_limits (identifier, attempts, first_attempt, last_attempt) VALUES (?, 1, ?, ?)");
    $stmt->execute([$identifier, $now, $now]);
    return true;
}

function resetRateLimit($identifier) {
    $db = getDB();
    $stmt = $db->prepare("DELETE FROM rate_limits WHERE identifier = ?");
    $stmt->execute([$identifier]);
}

// === Input-Sanitizing ===
function sanitizeText($text) {
    return htmlspecialchars(trim($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function sanitizePlainText($text) {
    return trim($text);
}

// === Kampagnenstatus aktualisieren (kein GET-Seiteneffekt) ===
function updateCampaignStatus($db, $customerId = null) {
    if ($customerId === null) {
        $customerId = getCurrentCustomerId();
    }
    if ($customerId === null || $customerId <= 0) {
        return;
    }

    $stmt = $db->prepare("SELECT COUNT(*) as total FROM spin_pool WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $totalPool = intval($stmt->fetch()['total'] ?? 0);

    $stmt = $db->prepare("SELECT COUNT(*) as used FROM spin_pool WHERE customer_id = ? AND is_used = 1");
    $stmt->execute([$customerId]);
    $usedPool = intval($stmt->fetch()['used'] ?? 0);

    $remaining = max(0, $totalPool - $usedPool);

    $stmt = $db->prepare("SELECT setting_value FROM settings WHERE customer_id = ? AND setting_key = 'campaign_status'");
    $stmt->execute([$customerId]);
    $row = $stmt->fetch();
    $currentStatus = $row ? $row['setting_value'] : 'running';

    $newStatus = null;
    if ($remaining <= 0 && $totalPool > 0 && $currentStatus === 'running') {
        $newStatus = 'ended';
    } elseif ($remaining > 0 && $currentStatus === 'ended') {
        $newStatus = 'running';
    }

    if ($newStatus !== null) {
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', ?)");
        $stmt->execute([$customerId, $newStatus]);
    }
}

// === Pfad-Validierung für bestehende Uploads ===
function validateExistingImagePath($path) {
    if (empty($path)) return null;
    
    $uploadDir = realpath(__DIR__ . '/../uploads');
    if (!$uploadDir) return null;
    
    $projectRoot = realpath(__DIR__ . '/../..');
    $absolutePath = realpath($projectRoot . '/' . ltrim($path, '/'));
    
    if ($absolutePath === false) return null;
    if (strpos($absolutePath, $uploadDir) !== 0) return null;
    if (!is_file($absolutePath)) return null;
    
    return $path;
}

// === Bild-Optimierung ===
function optimizeImage($sourcePath, $outputPath, $maxWidth = 800, $maxHeight = 800, $quality = 85) {
    if (!extension_loaded('gd')) {
        // GD nicht verfügbar, Original kopieren
        copy($sourcePath, $outputPath);
        return true;
    }

    list($origWidth, $origHeight, $type) = getimagesize($sourcePath);
    if (!$origWidth || !$origHeight) {
        copy($sourcePath, $outputPath);
        return true;
    }

    // Aspect-Ratio beibehalten
    $ratio = min($maxWidth / $origWidth, $maxHeight / $origHeight, 1);
    $newWidth = (int)($origWidth * $ratio);
    $newHeight = (int)($origHeight * $ratio);

    $srcImage = null;
    switch ($type) {
        case IMAGETYPE_JPEG: $srcImage = imagecreatefromjpeg($sourcePath); break;
        case IMAGETYPE_PNG: $srcImage = imagecreatefrompng($sourcePath); break;
        case IMAGETYPE_GIF: $srcImage = imagecreatefromgif($sourcePath); break;
        case IMAGETYPE_WEBP: $srcImage = imagecreatefromwebp($sourcePath); break;
    }

    if (!$srcImage) {
        copy($sourcePath, $outputPath);
        return true;
    }

    $dstImage = imagecreatetruecolor($newWidth, $newHeight);

    // PNG/GIF: Transparenz erhalten
    if ($type == IMAGETYPE_PNG || $type == IMAGETYPE_GIF) {
        imagealphablending($dstImage, false);
        imagesavealpha($dstImage, true);
        $transparent = imagecolorallocatealpha($dstImage, 255, 255, 255, 127);
        imagefill($dstImage, 0, 0, $transparent);
    }

    imagecopyresampled($dstImage, $srcImage, 0, 0, 0, 0, $newWidth, $newHeight, $origWidth, $origHeight);

    $ext = strtolower(pathinfo($outputPath, PATHINFO_EXTENSION));
    switch ($ext) {
        case 'jpg':
        case 'jpeg': imagejpeg($dstImage, $outputPath, $quality); break;
        case 'png': imagepng($dstImage, $outputPath, (int)round(9 - ($quality / 11))); break;
        case 'gif': imagegif($dstImage, $outputPath); break;
        case 'webp': imagewebp($dstImage, $outputPath, $quality); break;
        default: imagejpeg($dstImage, $outputPath, $quality);
    }

    imagedestroy($srcImage);
    imagedestroy($dstImage);
    return true;
}

// === Datei-Upload-Validierung ===
function validateImageUpload($file) {
    if (!isset($file['tmp_name']) || empty($file['tmp_name'])) {
        return ['valid' => false, 'error' => 'Keine Datei hochgeladen'];
    }

    // MIME-Type prüfen
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    // finfo_close() is deprecated in PHP 8.5+

    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!in_array($mimeType, $allowedMimes)) {
        return ['valid' => false, 'error' => 'Ungültiger Dateityp. Erlaubt: JPG, PNG, GIF, WebP'];
    }

    // Dateigröße prüfen (max 5 MB)
    $maxSize = 5 * 1024 * 1024;
    if ($file['size'] > $maxSize) {
        return ['valid' => false, 'error' => 'Datei zu groß (max 5 MB)'];
    }

    // Dateiendung prüfen
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    if (!in_array($ext, $allowedExts)) {
        return ['valid' => false, 'error' => 'Ungültige Dateiendung'];
    }

    // Sicheren Dateinamen generieren
    $safeExt = $ext;
    $safeName = bin2hex(random_bytes(8)) . '.' . $safeExt;

    return ['valid' => true, 'safeName' => $safeName, 'mimeType' => $mimeType];
}
