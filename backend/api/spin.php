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

    // Alle aktiven Segmente + verbleibende Pool-Anzahl laden
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, image, theme, unlimited, depleted_behavior, is_respin FROM segments WHERE customer_id = ? AND is_active = 1 ORDER BY sort_order, id");
    $stmt->execute([$customerId]);
    $allSegments = $stmt->fetchAll();

    $poolStmt = $db->prepare("SELECT segment_id, COUNT(*) AS c FROM spin_pool WHERE customer_id = ? AND is_used = 0 GROUP BY segment_id");
    $poolStmt->execute([$customerId]);
    $remainingBy = [];
    foreach ($poolStmt->fetchAll() as $r) { $remainingBy[$r['segment_id']] = intval($r['c']); }

    foreach ($allSegments as &$s) {
        $s['is_unlimited'] = intval($s['unlimited']) === 1;
        $s['remaining'] = $s['is_unlimited'] ? null : ($remainingBy[$s['id']] ?? 0);
        $s['available'] = $s['is_unlimited'] || $s['remaining'] > 0;
        $s['depleted'] = !$s['is_unlimited'] && ($s['remaining'] <= 0);
    }
    unset($s);

    // Angezeigte Segmente = aktive minus (erschöpft UND depleted_behavior=hide)
    $displaySegments = array_values(array_filter($allSegments, function ($s) {
        return !($s['depleted'] && $s['depleted_behavior'] === 'hide');
    }));

    // Gewinnbare Kandidaten
    $candidates = array_values(array_filter($allSegments, function ($s) { return $s['available']; }));

    if (count($candidates) === 0 || count($displaySegments) === 0) {
        $db->rollBack();
        $stmt = $db->prepare("INSERT OR REPLACE INTO settings (customer_id, setting_key, setting_value) VALUES (?, 'campaign_status', 'ended')");
        $stmt->execute([$customerId]);
        jsonResponse(['error' => 'Kampagne abgeschlossen. Alle Gewinne wurden vergeben.', 'code' => 'campaign_ended'], 400);
    }

    // Gewichtete Auswahl: limitiert nach remaining; unlimited teilen sich
    // dynamisch die "Restdrehungen" (geschätzte Gesamtdrehungen minus die
    // verbleibenden limitierten Lose) – kein manuelles Gewicht nötig.
    $estStmt = $db->prepare("SELECT setting_value FROM settings WHERE customer_id = ? AND setting_key = 'estimated_spins'");
    $estStmt->execute([$customerId]);
    $estRow = $estStmt->fetch();
    $estimatedSpins = $estRow ? max(1, intval($estRow['setting_value'])) : 100;

    $limitedRemaining = 0;
    $countUnlimited = 0;
    foreach ($candidates as $c) {
        if ($c['is_unlimited']) { $countUnlimited++; }
        else { $limitedRemaining += intval($c['remaining']); }
    }
    $leftover = max($countUnlimited, $estimatedSpins - $limitedRemaining);
    $unlimitedWeight = $countUnlimited > 0 ? max(1, (int)round($leftover / $countUnlimited)) : 0;

    $weightOf = function ($s) use ($unlimitedWeight) {
        return $s['is_unlimited'] ? $unlimitedWeight : intval($s['remaining']);
    };
    $total = 0;
    foreach ($candidates as $c) { $total += $weightOf($c); }
    $rnd = mt_rand(1, max(1, $total));
    $acc = 0;
    $winner = $candidates[0];
    foreach ($candidates as $c) { $acc += $weightOf($c); if ($rnd <= $acc) { $winner = $c; break; } }

    // Bei limitiertem Gewinn: konkreten Pool-Eintrag zum Verbrauchen holen
    $poolEntry = null;
    if (!$winner['is_unlimited']) {
        $pe = $db->prepare("SELECT id FROM spin_pool WHERE customer_id = ? AND segment_id = ? AND is_used = 0 ORDER BY RANDOM() LIMIT 1");
        $pe->execute([$customerId, $winner['id']]);
        $poolEntry = $pe->fetch();
    }

    // winner_index: Position innerhalb der ANGEZEIGTEN Segmente (Frontend-Rad)
    $segments = $displaySegments;
    $winnerIndex = 0;
    foreach ($displaySegments as $idx => $seg) {
        if ($seg['id'] == $winner['id']) { $winnerIndex = $idx; break; }
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

        // Pool-Eintrag als used markieren (nur bei limitiertem Gewinn)
        if ($poolEntry) {
            $stmt = $db->prepare("UPDATE spin_pool SET is_used = 1, used_at = datetime('now'), spin_id = ? WHERE customer_id = ? AND id = ?");
            $stmt->execute([$spinId, $customerId, $poolEntry['id']]);
        }

        // Lead mit Spin und Gewinn verknüpfen – NICHT bei Neu-Dreh-Segmenten,
        // damit der Lead für den nächsten (echten) Dreh erhalten bleibt.
        if ($leadId && empty($winner['is_respin'])) {
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

                    // Versand über den konfigurierten Treiber (Resend/SMTP/mail)
                    require_once __DIR__ . '/../utils/mailer.php';
                    $mailResult = sendWinnerEmail($lead['email'], $lead['name'], $subject, $body);
                    $mailSent = !empty($mailResult['success']);

                    // Lokales Logging (hilft beim Debuggen der Zustellung)
                    $logDir = __DIR__ . '/../logs';
                    if (!is_dir($logDir)) {
                        @mkdir($logDir, 0755, true);
                    }
                    $logFile = $logDir . '/mail.log';
                    $logEntry = date('Y-m-d H:i:s') . " | To: " . $lead['email'] . " | Subject: " . $subject
                        . " | Sent: " . ($mailSent ? 'YES' : 'NO')
                        . ($mailSent ? '' : ' | Error: ' . ($mailResult['error'] ?? '?')) . "\n";
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
