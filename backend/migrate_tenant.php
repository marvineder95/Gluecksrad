<?php
/**
 * Migration: Multi-Tenant Architektur
 * 
 * Erweitert die bestehende Datenbank um Kunden-Isolierung.
 * Sollte EINMALIG pro Datenbank ausgeführt werden.
 */

require_once __DIR__ . '/config/database.php';

$db = getDB();

echo "=== Multi-Tenant Migration ===\n\n";

$db->beginTransaction();

try {
    // 1. Kunden-Tabelle erstellen
    $db->exec("CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        contact_name TEXT,
        email TEXT NOT NULL,
        logo TEXT,
        is_active INTEGER DEFAULT 1,
        subdomain TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    echo "✓ customers Tabelle erstellt\n";

    // 2. Default-Kunde anlegen (falls noch nicht vorhanden)
    $stmt = $db->prepare("INSERT OR IGNORE INTO customers (id, company_name, contact_name, email, subdomain) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([1, 'Point4 Studios Demo', 'Admin', 'demo@point4studio.at', 'demo']);
    echo "✓ Default-Kunde angelegt (ID: 1)\n";

    // 3. users Tabelle erweitern
    $columns = $db->query("PRAGMA table_info(users)")->fetchAll(PDO::FETCH_COLUMN, 1);
    
    if (!in_array('email', $columns)) {
        $db->exec("ALTER TABLE users ADD COLUMN email TEXT");
    }
    if (!in_array('role', $columns)) {
        $db->exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer_admin'");
    }
    if (!in_array('customer_id', $columns)) {
        $db->exec("ALTER TABLE users ADD COLUMN customer_id INTEGER REFERENCES customers(id)");
    }
    if (!in_array('is_active', $columns)) {
        $db->exec("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1");
    }
    if (in_array('username', $columns) && !in_array('email', $columns)) {
        // Fallback: username nach email kopieren
        $db->exec("UPDATE users SET email = username WHERE email IS NULL OR email = ''");
    }
    
    // Bestehenden Benutzer zum Super Admin machen und E-Mail korrigieren
    $db->exec("UPDATE users SET role = 'super_admin', customer_id = NULL, email = 'admin@point4studio.at' WHERE id = 1");
    $db->exec("UPDATE users SET role = 'super_admin', customer_id = NULL, email = COALESCE(NULLIF(email, ''), 'admin@point4studio.at') WHERE email IS NULL OR email = ''");
    echo "✓ users Tabelle erweitert, bestehender Benutzer ist jetzt Super Admin\n";

    // 4. Bestehende Tabellen um customer_id erweitern
    $tablesToExtend = [
        'segments',
        'settings',
        'spins',
        'spin_pool',
        'campaign_archives'
    ];

    foreach ($tablesToExtend as $table) {
        $cols = $db->query("PRAGMA table_info($table)")->fetchAll(PDO::FETCH_COLUMN, 1);
        if (!in_array('customer_id', $cols)) {
            // SQLite erlaubt keine REFERENCES-Spalte mit non-NULL Default.
            // Daher zuerst ohne NOT NULL/REFERENCES hinzufügen, dann Daten setzen.
            $db->exec("ALTER TABLE $table ADD COLUMN customer_id INTEGER DEFAULT 1");
            $db->exec("UPDATE $table SET customer_id = 1 WHERE customer_id IS NULL");
            echo "✓ $table um customer_id erweitert\n";
        } else {
            echo "  - $table hat bereits customer_id\n";
        }
    }

    // 5. settings Tabelle: UNIQUE Constraint auf (customer_id, setting_key)
    // SQLite erlaubt kein nachträgliches Hinzufügen von UNIQUE via ALTER.
    // Wir prüfen, ob das Constraint bereits existiert.
    $indexes = $db->query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='settings'")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('idx_settings_customer_key', $indexes)) {
        $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_customer_key ON settings(customer_id, setting_key)");
        echo "✓ UNIQUE Index auf settings(customer_id, setting_key) erstellt\n";
    }

    // 6. Weitere Indizes erstellen
    $db->exec("CREATE INDEX IF NOT EXISTS idx_users_customer ON users(customer_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_segments_customer ON segments(customer_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_settings_customer ON settings(customer_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_spins_customer ON spins(customer_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_spin_pool_customer ON spin_pool(customer_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_campaign_archives_customer ON campaign_archives(customer_id)");
    echo "✓ Indizes erstellt\n";

    // 7. Bestehende Daten dem Default-Kunden zuordnen (sollte durch DEFAULT bereits geschehen sein)
    foreach ($tablesToExtend as $table) {
        $stmt = $db->prepare("UPDATE $table SET customer_id = 1 WHERE customer_id IS NULL");
        $stmt->execute();
    }
    echo "✓ Bestehende Daten dem Default-Kunden zugeordnet\n";

    $db->commit();
    echo "\n✅ Migration erfolgreich abgeschlossen.\n";
    echo "Super Admin E-Mail: admin@point4studio.at\n";
    echo "Bitte Passwort sofort ändern.\n";

} catch (Exception $e) {
    $db->rollBack();
    echo "\n❌ Fehler bei der Migration: " . $e->getMessage() . "\n";
    exit(1);
}
