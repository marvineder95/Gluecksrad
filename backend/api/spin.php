<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

$customerId = getCurrentCustomerId();
if ($customerId === null || $customerId <= 0) {
    jsonResponse(['error' => 'Kundenkontext erforderlich'], 400);
}

// DELETE /api/spin - Alle Spins löschen (Kampagne zurücksetzen OHNE Archivierung)
if ($method === 'DELETE') {
    requireCustomerAdmin();
    validateCsrf();

    $db->beginTransaction();
    try {
        $stmt = $db->prepare("DELETE FROM spins WHERE customer_id = ?");
        $stmt->execute([$customerId]);
        $stmt = $db->prepare("DELETE FROM spin_pool WHERE customer_id = ?");
        $stmt->execute([$customerId]);

        // Neuen Pool generieren
        require_once __DIR__ . '/../utils/pool.php';
        $poolSize = generateSpinPool($db, $customerId);

        // Status auf running setzen
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', 'running')");
        $stmt->execute([$customerId]);

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
    $stmt = $db->prepare("SELECT setting_value FROM settings WHERE customer_id = ? AND setting_key = 'campaign_status'");
    $stmt->execute([$customerId]);
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
    $stmt = $db->prepare("SELECT id, segment_id FROM spin_pool WHERE customer_id = ? AND is_used = 0 ORDER BY RANDOM() LIMIT 1");
    $stmt->execute([$customerId]);
    $poolEntry = $stmt->fetch();

    if (!$poolEntry) {
        $db->rollBack();
        // Auto-Ende der Kampagne
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', 'ended')");
        $stmt->execute([$customerId]);
        jsonResponse(['error' => 'Kampagne abgeschlossen. Alle Gewinne wurden vergeben.', 'code' => 'campaign_ended'], 400);
    }

    // Segment-Details laden
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, image, theme FROM segments WHERE customer_id = ? AND id = ? AND is_active = 1");
    $stmt->execute([$customerId, $poolEntry['segment_id']]);
    $winner = $stmt->fetch();

    if (!$winner) {
        $db->rollBack();
        jsonResponse(['error' => 'Segment nicht mehr verfügbar'], 500);
    }

    // Alle aktiven Segmente laden (für winner_index Berechnung)
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, image, theme FROM segments WHERE customer_id = ? AND is_active = 1 ORDER BY sort_order, id");
    $stmt->execute([$customerId]);
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

    $leadId = null;
    $data = json_decode(file_get_contents('php://input'), true);
    if (!empty($data['lead_id'])) {
        $leadId = intval($data['lead_id']);
        // Prüfen, ob Lead zu diesem Kunden gehört und noch nicht verknüpft ist
        $stmt = $db->prepare("SELECT id FROM leads WHERE customer_id = ? AND id = ? AND spin_id IS NULL");
        $stmt->execute([$customerId, $leadId]);
        if (!$stmt->fetch()) {
            $leadId = null;
        }
    }

    if (!$isTest) {
        // Echten Spin speichern
        $stmt = $db->prepare("INSERT INTO spins (customer_id, segment_id, segment_name, win_text, lead_id) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$customerId, $winner['id'], $winner['name'], $winner['win_text'], $leadId]);
        $spinId = $db->lastInsertId();

        // Pool-Eintrag als used markieren
        $stmt = $db->prepare("UPDATE spin_pool SET is_used = 1, used_at = datetime('now'), spin_id = ? WHERE customer_id = ? AND id = ?");
        $stmt->execute([$spinId, $customerId, $poolEntry['id']]);

        // Lead mit Spin und Gewinn verknüpfen
        if ($leadId) {
            $stmt = $db->prepare("UPDATE leads SET spin_id = ?, prize = ? WHERE id = ?");
            $stmt->execute([$spinId, $winner['name'], $leadId]);

            // Gewinn-E-Mail an Lead senden, wenn aktiviert
            $stmt = $db->prepare("SELECT name, email FROM leads WHERE id = ?");
            $stmt->execute([$leadId]);
            $lead = $stmt->fetch();

            if ($lead) {
                $emailSettings = [
                    'winner_email_enabled' => '0',
                    'winner_email_subject' => 'Herzlichen Glückwunsch zu deinem Gewinn!',
                    'winner_email_body' => "Hallo {{name}},\n\nherzlichen Glückwunsch! Du hast beim Glücksrad gewonnen: {{prize}}.\n\n{{win_text}}\n\nViel Freude damit!",
                    'winner_email_sender' => 'noreply@point4spin.at'
                ];
                $stmt = $db->prepare("SELECT setting_key, setting_value FROM settings WHERE customer_id = ? AND setting_key LIKE 'winner_email_%'");
                $stmt->execute([$customerId]);
                foreach ($stmt->fetchAll() as $row) {
                    $emailSettings[$row['setting_key']] = $row['setting_value'];
                }

                if ($emailSettings['winner_email_enabled'] === '1' || $emailSettings['winner_email_enabled'] === 1) {
                    $replacements = [
                        '{{name}}' => $lead['name'],
                        '{{email}}' => $lead['email'],
                        '{{prize}}' => $winner['name'],
                        '{{win_text}}' => $winner['win_text'] ?? '',
                        '{{company}}' => ''
                    ];
                    $subject = strtr($emailSettings['winner_email_subject'], $replacements);
                    $body = strtr($emailSettings['winner_email_body'], $replacements);
                    $headers = 'From: ' . $emailSettings['winner_email_sender'] . "\r\n" .
                               'Reply-To: ' . $emailSettings['winner_email_sender'] . "\r\n" .
                               'Content-Type: text/plain; charset=UTF-8' . "\r\n" .
                               'X-Mailer: PHP/' . phpversion();
                    $mailSent = @mail($lead['email'], $subject, $body, $headers);

                    // Lokales Logging für Tests (wenn mail() nicht konfiguriert ist)
                    $logDir = __DIR__ . '/../logs';
                    if (!is_dir($logDir)) {
                        @mkdir($logDir, 0755, true);
                    }
                    $logFile = $logDir . '/mail.log';
                    $logEntry = date('Y-m-d H:i:s') . " | To: " . $lead['email'] . " | Subject: " . $subject . " | Sent: " . ($mailSent ? 'YES' : 'NO') . "\n";
                    $logEntry .= "Body:\n" . $body . "\n" . str_repeat('-', 60) . "\n";
                    @file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
                }
            }
        }
    }

    $db->commit();

    // Kampagnenstatus ggf. aktualisieren
    updateCampaignStatus($db, $customerId);

    jsonResponse([
        'success' => true,
        'winner' => $winner,
        'winner_index' => $winnerIndex,
        'total_segments' => count($segments),
        'spin_id' => $isTest ? 0 : ($spinId ?? 0)
    ]);
}
