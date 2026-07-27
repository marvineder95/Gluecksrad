<?php
// Router für den PHP-Entwicklungsserver (php -S).
// Der eingebaute Server ignoriert .htaccess – daher werden sensible Pfade hier blockiert.
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');

$blockedPaths = '#^/(database/|backend/(config|logs|vendor)/|\.git)#';
$blockedFiles = '#(\.sqlite3?|\.db|\.log|secret\.php|/setup\.php|/migrate[^/]*\.php)$#';

if (preg_match($blockedPaths, $uri) || preg_match($blockedFiles, $uri)) {
    http_response_code(403);
    exit('Forbidden');
}

return false; // alles andere normal ausliefern
