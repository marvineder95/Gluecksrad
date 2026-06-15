<?php
/**
 * Migration: Pool-basierte Verteilung
 * Erzeugt spin_pool aus bestehenden Segmenten und markiert bereits gespielte Spins als used.
 */
require_once __DIR__ . '/config/database.php';

$db = getDB();

echo "=== Migration: Pool-basierte Verteilung ===\n";

// 1. Tabellen erstellen (falls nicht vorhanden)
$db->exec("CREATE TABLE IF NOT EXISTS spin_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    spin_id INTEGER,
    FOREIGN KEY (segment_id) REFERENCES segments(id)
)");
$db->exec("CREATE INDEX IF NOT EXISTS idx_spin_pool_order ON spin_pool(sequence_order)");
$db->exec("CREATE INDEX IF NOT EXISTS idx_spin_pool_used ON spin_pool(is_used)");

echo "✓ spin_pool Tabelle erstellt\n";

$db->exec("CREATE TABLE IF NOT EXISTS campaign_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spin_count INTEGER NOT NULL DEFAULT 0,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
)");

echo "✓ campaign_archives Tabelle erstellt\n";

// 2. Prüfen, ob bereits ein Pool existiert
$count = $db->query("SELECT COUNT(*) as c FROM spin_pool")->fetch()['c'];
if ($count > 0) {
    echo "⚠ Pool existiert bereits ($count Einträge). Überspringe Generierung.\n";
    exit(0);
}

// 3. Aktive Segmente mit max_count laden
$segments = $db->query("SELECT id, max_count FROM segments WHERE is_active = 1 AND max_count > 0")->fetchAll();

if (empty($segments)) {
    echo "⚠ Keine aktiven Segmente mit max_count > 0 gefunden. Pool bleibt leer.\n";
    exit(0);
}

// 4. Pool generieren
$pool = [];
foreach ($segments as $seg) {
    for ($i = 0; $i < intval($seg['max_count']); $i++) {
        $pool[] = intval($seg['id']);
    }
}

shuffle($pool);
echo "✓ Pool generiert: " . count($pool) . " Einträge\n";

// 5. Pool in Datenbank einfügen
$insert = $db->prepare("INSERT INTO spin_pool (segment_id, sequence_order) VALUES (?, ?)");
foreach ($pool as $order => $segmentId) {
    $insert->execute([$segmentId, $order]);
}

echo "✓ Pool in Datenbank geschrieben\n";

// 6. Bestehende Spins als used markieren
$spins = $db->query("SELECT id, segment_id, created_at FROM spins ORDER BY created_at ASC")->fetchAll();

if (!empty($spins)) {
    // Für jeden Spin: Finde einen unbenutzten Pool-Eintrag für dieses Segment und markiere als used
    $updatePool = $db->prepare("UPDATE spin_pool SET is_used = 1, used_at = ?, spin_id = ? WHERE id = (
        SELECT id FROM spin_pool WHERE segment_id = ? AND is_used = 0 ORDER BY RANDOM() LIMIT 1
    )");
    
    $markedCount = 0;
    foreach ($spins as $spin) {
        $updatePool->execute([$spin['created_at'], $spin['id'], $spin['segment_id']]);
        if ($updatePool->rowCount() > 0) {
            $markedCount++;
        }
    }
    
    echo "✓ $markedCount bestehende Spins als 'used' im Pool markiert\n";
} else {
    echo "✓ Keine bestehenden Spins vorhanden\n";
}

// 7. Statistik anzeigen
$totalPool = $db->query("SELECT COUNT(*) as c FROM spin_pool")->fetch()['c'];
$usedPool = $db->query("SELECT COUNT(*) as c FROM spin_pool WHERE is_used = 1")->fetch()['c'];
$remainingPool = $totalPool - $usedPool;

echo "\n=== Migration abgeschlossen ===\n";
echo "Gesamt Pool-Einträge: $totalPool\n";
echo "Bereits verbraucht:   $usedPool\n";
echo "Verbleibend:          $remainingPool\n";
