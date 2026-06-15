<?php
/**
 * Einmaliges Setup-Skript für neue Installationen.
 * Ruft auf: php backend/setup.php
 * Oder via Browser (nur wenn DB leer).
 */

$dbPath = __DIR__ . '/../database/gluecksrad.sqlite';
$schemaPath = __DIR__ . '/../database/schema.sql';

if (!file_exists($schemaPath)) {
    die("Fehler: schema.sql nicht gefunden unter $schemaPath\n");
}

// Prüfen ob DB bereits existiert und Tabellen hat
$needsSetup = true;
if (file_exists($dbPath)) {
    try {
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN);
        if (in_array('users', $tables) && in_array('segments', $tables)) {
            $needsSetup = false;
            echo "Datenbank bereits initialisiert. Kein Setup nötig.\n";
        }
    } catch (PDOException $e) {
        // Fehler -> Setup durchführen
    }
}

if ($needsSetup) {
    // Sicherstellen, dass das Verzeichnis existiert
    $dbDir = dirname($dbPath);
    if (!is_dir($dbDir)) {
        mkdir($dbDir, 0755, true);
    }

    $sql = file_get_contents($schemaPath);
    
    try {
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec("PRAGMA foreign_keys = ON");
        $pdo->exec($sql);
        echo "Datenbank erfolgreich initialisiert unter: $dbPath\n";
        echo "Setup erfolgreich. Benutzername: admin\n";
        echo "WICHTIG: Das initiale Passwort ist ein zufälliger Hash.\n";
        echo "Bitte melde dich an und setze sofort ein neues Passwort im Admin-Panel.\n";
    } catch (PDOException $e) {
        die("Fehler beim Setup: " . $e->getMessage() . "\n");
    }
}
