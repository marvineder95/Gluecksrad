<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// DELETE /api/spin - Alle Spins löschen (Kampagne zurücksetzen OHNE Archivierung)
if ($method === 'DELETE') {
    requireAuth();
    validateCsrf();
    
    $db->beginTransaction();
    try {
        $db->exec("DELETE FROM spins");
        $db->exec("DELETE FROM spin_pool");
        
        // Neuen Pool generieren
        require_once __DIR__ . '/campaign.php';
        $poolSize = generateSpinPool($db);
        
        // Status auf running setzen
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('campaign_status', 'running')");
        $stmt->execute();
        
        $db->commit();
        jsonResponse(['success' => true, 'message' => 'Kampagne zurückgesetzt', 'pool_size' => $poolSize]);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Zurücksetzen: ' . $e->getMessage()], 500);
    }
}

// POST /api/spin - Rad drehen
if ($method === 'POST') {
    $isTest = isset($_GET['test']) && $_GET['test'] === '1';
    
    // Rate-Limiting: max. 1 Spin pro Sekunde pro IP
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    checkRateLimit('spin:' . $clientIp, 1, 1);
    
    $db->beginTransaction();

    // Kampagnenstatus prüfen
    $stmt = $db->query("SELECT setting_value FROM settings WHERE setting_key = 'campaign_status'");
    $statusRow = $stmt->fetch();
    $campaignStatus = $statusRow ? $statusRow['setting_value'] : 'running';

    if ($campaignStatus === 'ended') {
        $db->rollBack();
        jsonResponse(['error' => 'Kampagne ist beendet.'], 400);
    }
    if ($campaignStatus === 'paused') {
        $db->rollBack();
        jsonResponse(['error' => 'Kampagne ist pausiert.'], 400);
    }

    // Zufälligen unbenutzten Pool-Eintrag holen
    $stmt = $db->query("SELECT id, segment_id FROM spin_pool WHERE is_used = 0 ORDER BY RANDOM() LIMIT 1");
    $poolEntry = $stmt->fetch();

    if (!$poolEntry) {
        $db->rollBack();
        // Auto-Ende der Kampagne
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('campaign_status', 'ended')");
        $stmt->execute();
        jsonResponse(['error' => 'Kampagne abgeschlossen. Alle Gewinne wurden vergeben.', 'code' => 'campaign_ended'], 400);
    }

    // Segment-Details laden
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, image, theme FROM segments WHERE id = ? AND is_active = 1");
    $stmt->execute([$poolEntry['segment_id']]);
    $winner = $stmt->fetch();

    if (!$winner) {
        $db->rollBack();
        jsonResponse(['error' => 'Segment nicht mehr verfügbar'], 500);
    }

    // Alle aktiven Segmente laden (für winner_index Berechnung)
    $stmt = $db->query("SELECT id, name, color, win_text, weight, image, theme FROM segments WHERE is_active = 1 ORDER BY sort_order, id");
    $segments = $stmt->fetchAll();

    if (count($segments) === 0) {
        $db->rollBack();
        jsonResponse(['error' => 'Keine aktiven Segmente vorhanden'], 400);
    }

    // winner_index: Position im vollständigen Segment-Array (für Frontend-Animation)
    $winnerIndex = 0;
    foreach ($segments as $idx => $seg) {
        if ($seg['id'] == $winner['id']) {
            $winnerIndex = $idx;
            break;
        }
    }

    if (!$isTest) {
        // Echten Spin speichern
        $stmt = $db->prepare("INSERT INTO spins (segment_id, segment_name, win_text) VALUES (?, ?, ?)");
        $stmt->execute([$winner['id'], $winner['name'], $winner['win_text']]);
        $spinId = $db->lastInsertId();

        // Pool-Eintrag als used markieren
        $stmt = $db->prepare("UPDATE spin_pool SET is_used = 1, used_at = datetime('now'), spin_id = ? WHERE id = ?");
        $stmt->execute([$spinId, $poolEntry['id']]);
    }

    $db->commit();
    
    // Kampagnenstatus ggf. aktualisieren
    updateCampaignStatus($db);

    jsonResponse([
        'success' => true,
        'winner' => $winner,
        'winner_index' => $winnerIndex,
        'total_segments' => count($segments),
        'spin_id' => $isTest ? 0 : ($spinId ?? 0)
    ]);
}
