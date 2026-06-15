<?php
require_once __DIR__ . '/config/database.php';

$db = getDB();

// Migrationsschritte sind idempotent (IF NOT EXISTS / TRY-CATCH)
$migrations = [
    // 1. max_count zu segments hinzufügen
    "ALTER TABLE segments ADD COLUMN max_count INTEGER DEFAULT 0",
    
    // 2. API-Token Ablaufzeit
    "ALTER TABLE users ADD COLUMN api_token_expires_at DATETIME",
    
    // 3. Performance-Indizes
    "CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token)",
    "CREATE INDEX IF NOT EXISTS idx_spins_segment_id ON spins(segment_id)",
    "CREATE INDEX IF NOT EXISTS idx_spins_created_at ON spins(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_segments_is_active ON segments(is_active)"
];

foreach ($migrations as $sql) {
    try {
        $db->exec($sql);
    } catch (PDOException $e) {
        // Spalte/Index existiert möglicherweise bereits
    }
}

// 4. Neue Settings einfügen (falls nicht vorhanden)
$newSettings = [
    ['total_spins_limit', '1000'],
    ['campaign_status', 'running'],
    ['campaign_started_at', date('c')],
    ['accent_color', '#D4AF37']
];

foreach ($newSettings as $s) {
    $stmt = $db->prepare("INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)");
    $stmt->execute($s);
}

echo json_encode(['success' => true, 'message' => 'Migration abgeschlossen']);
