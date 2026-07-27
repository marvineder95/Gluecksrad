<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

require_once __DIR__ . '/../utils/pool.php';

// GET /api/campaign - Archivierte Kampagnen auflisten
if ($method === 'GET') {
    $customerId = getCurrentCustomerId();
    if ($customerId === null || $customerId <= 0) {
        jsonResponse([]);
    }
    $stmt = $db->prepare("SELECT id, name, spin_count, archived_at FROM campaign_archives WHERE customer_id = ? ORDER BY archived_at DESC");
    $stmt->execute([$customerId]);
    jsonResponse($stmt->fetchAll());
}

// POST /api/campaign?action=archive - Aktuelle Kampagne archivieren & neuen Pool erzeugen
if ($method === 'POST') {
    requireCustomerAdmin();
    validateCsrf();

    $customerId = requireCustomerContext();
    $action = $_GET['action'] ?? '';

    if ($action === 'archive') {
        $data = json_decode(file_get_contents('php://input'), true);
        $name = sanitizeText($data['name'] ?? 'Kampagne');

        $db->beginTransaction();

        try {
            // Aktuelle Spin-Anzahl ermitteln
            $stmt = $db->prepare("SELECT COUNT(*) as total FROM spins WHERE customer_id = ?");
            $stmt->execute([$customerId]);
            $spinCount = intval($stmt->fetch()['total']);

            // Archivieren
            $stmt = $db->prepare("INSERT INTO campaign_archives (customer_id, name, spin_count) VALUES (?, ?, ?)");
            $stmt->execute([$customerId, $name, $spinCount]);

            // Alte Daten löschen
            $stmt = $db->prepare("DELETE FROM spins WHERE customer_id = ?");
            $stmt->execute([$customerId]);
            $stmt = $db->prepare("DELETE FROM spin_pool WHERE customer_id = ?");
            $stmt->execute([$customerId]);

            // Neuen Pool generieren
            $poolSize = generateSpinPool($db, $customerId);

            // Status auf running setzen
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', 'running')");
            $stmt->execute([$customerId]);

            $db->commit();

            jsonResponse([
                'success' => true,
                'message' => 'Kampagne archiviert und zurückgesetzt',
                'pool_size' => $poolSize
            ]);
        } catch (Exception $e) {
            $db->rollBack();
            jsonResponse(['error' => 'Fehler beim Archivieren: ' . $e->getMessage()], 500);
        }
    }

    if ($action === 'reset') {
        $db->beginTransaction();

        try {
            // Alle Segmente soft-deleted
            $stmt = $db->prepare("UPDATE segments SET is_active = 0 WHERE customer_id = ?");
            $stmt->execute([$customerId]);

            // Alle Spins löschen
            $stmt = $db->prepare("DELETE FROM spins WHERE customer_id = ?");
            $stmt->execute([$customerId]);

            // Pool löschen
            $stmt = $db->prepare("DELETE FROM spin_pool WHERE customer_id = ?");
            $stmt->execute([$customerId]);

            // Status auf running setzen
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', 'running')");
            $stmt->execute([$customerId]);

            $db->commit();

            jsonResponse([
                'success' => true,
                'message' => 'Kampagne vollständig zurückgesetzt'
            ]);
        } catch (Exception $e) {
            $db->rollBack();
            jsonResponse(['error' => 'Fehler beim Zurücksetzen: ' . $e->getMessage()], 500);
        }
    }

    jsonResponse(['error' => 'Ungültige Aktion'], 400);
}
