<?php
// SQLite Datenbankkonfiguration – reine DB-Verbindung, keine HTTP-Logik

if (!defined('DB_PATH')) {
    define('DB_PATH', getenv('DB_PATH') ?: __DIR__ . '/../../database/gluecksrad.sqlite');
}

function getDB() {
    static $pdo = null;
    static $lastPath = null;
    
    $dbPath = getenv('DB_PATH') ?: DB_PATH;
    
    // Neue Verbindung, wenn sich der Pfad geändert hat
    if ($pdo === null || $lastPath !== $dbPath) {
        try {
            $pdo = new PDO('sqlite:' . $dbPath);
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $pdo->exec("PRAGMA foreign_keys = ON");
            $lastPath = $dbPath;
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Datenbankverbindung fehlgeschlagen: ' . $e->getMessage()]);
            exit;
        }
    }
    return $pdo;
}
