<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// Hilfsfunktion: Pool aus aktiven Segmenten generieren
function generateSpinPool($db) {
    $segments = $db->query("SELECT id, max_count FROM segments WHERE is_active = 1 AND max_count > 0")->fetchAll();
    
    if (empty($segments)) {
        return 0;
    }
    
    $pool = [];
    foreach ($segments as $seg) {
        $maxCount = intval($seg['max_count']);
        for ($i = 0; $i < $maxCount; $i++) {
            $pool[] = intval($seg['id']);
        }
    }
    
    shuffle($pool);
    
    $db->beginTransaction();
    try {
        $stmt = $db->prepare("INSERT INTO spin_pool (segment_id, sequence_order) VALUES (?, ?)");
        foreach ($pool as $order => $segmentId) {
            $stmt->execute([$segmentId, $order]);
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }
    
    return count($pool);
}

// GET /api/campaign - Archivierte Kampagnen auflisten
if ($method === 'GET') {
    $stmt = $db->query("SELECT id, name, spin_count, archived_at FROM campaign_archives ORDER BY archived_at DESC");
    jsonResponse($stmt->fetchAll());
}

// POST /api/campaign?action=archive - Aktuelle Kampagne archivieren & neuen Pool erzeugen
if ($method === 'POST') {
    requireAuth();
    validateCsrf();

    $action = $_GET['action'] ?? '';
    
    if ($action === 'archive') {
        $data = json_decode(file_get_contents('php://input'), true);
        $name = sanitizeText($data['name'] ?? 'Kampagne');
        
        $db->beginTransaction();
        
        try {
            // Aktuelle Spin-Anzahl ermitteln
            $stmt = $db->query("SELECT COUNT(*) as total FROM spins");
            $spinCount = intval($stmt->fetch()['total']);
            
            // Archivieren
            $stmt = $db->prepare("INSERT INTO campaign_archives (name, spin_count) VALUES (?, ?)");
            $stmt->execute([$name, $spinCount]);
            
            // Alte Daten löschen
            $db->exec("DELETE FROM spins");
            $db->exec("DELETE FROM spin_pool");
            
            // Neuen Pool generieren
            $poolSize = generateSpinPool($db);
            
            // Status auf running setzen
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('campaign_status', 'running')");
            $stmt->execute();
            
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
            $db->exec("UPDATE segments SET is_active = 0");
            
            // Alle Spins löschen
            $db->exec("DELETE FROM spins");
            
            // Pool löschen
            $db->exec("DELETE FROM spin_pool");
            
            // Status auf running setzen
            $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('campaign_status', 'running')");
            $stmt->execute();
            
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
