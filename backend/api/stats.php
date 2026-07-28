<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// GET /api/stats - Statistiken abrufen
if ($method === 'GET') {
    $customerId = getCurrentCustomerId();
    if ($customerId === null || $customerId <= 0) {
        jsonResponse([
            'total_spins' => 0,
            'total_spins_limit' => 0,
            'remaining_spins' => 0,
            'campaign_status' => 'running',
            'progress_percent' => 0,
            'active_segments' => 0,
            'segment_stats' => [],
            'distribution' => [],
            'recent_spins' => []
        ]);
    }

    // Rate-Limiting: max. 30 Requests pro Minute pro IP
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    checkRateLimit('stats:' . $clientIp, 30, 60);

    // Pool-Statistiken
    $stmt = $db->prepare("SELECT COUNT(*) as total FROM spin_pool WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $totalPool = intval($stmt->fetch()['total'] ?? 0);

    $stmt = $db->prepare("SELECT COUNT(*) as used FROM spin_pool WHERE customer_id = ? AND is_used = 1");
    $stmt->execute([$customerId]);
    $usedPool = intval($stmt->fetch()['used'] ?? 0);

    $remaining = max(0, $totalPool - $usedPool);
    $progressPercent = $totalPool > 0 ? round(($usedPool / $totalPool) * 100, 1) : 0;

    // Kampagnen-Status
    $stmt = $db->prepare("SELECT setting_key, setting_value FROM settings WHERE customer_id = ? AND setting_key IN ('campaign_status', 'campaign_started_at')");
    $stmt->execute([$customerId]);
    $campaignSettings = [];
    foreach ($stmt->fetchAll() as $row) {
        $campaignSettings[$row['setting_key']] = $row['setting_value'];
    }

    // Status nur berechnen, nicht ändern (GET sollte idempotent sein)
    $campaignStatus = $campaignSettings['campaign_status'] ?? 'running';
    if ($remaining <= 0 && $totalPool > 0) {
        $campaignStatus = 'ended';
    } elseif ($remaining > 0 && $campaignStatus === 'ended') {
        $campaignStatus = 'running';
    }

    // Aktive Segmente zählen
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM segments WHERE customer_id = ? AND is_active = 1");
    $stmt->execute([$customerId]);
    $activeSegments = intval($stmt->fetch()['count']);

    // Aktive Segmente laden
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, image, theme, sort_order, max_count, unlimited, depleted_behavior, is_respin, image_offset_x, image_offset_y, image_rotation, image_scale FROM segments WHERE customer_id = ? AND is_active = 1 ORDER BY sort_order, id");
    $stmt->execute([$customerId]);
    $segmentRows = $stmt->fetchAll();

    // Pool-Counts pro Segment auf einmal holen
    $segmentIds = array_column($segmentRows, 'id');
    $poolCounts = [];
    if (!empty($segmentIds)) {
        $placeholders = implode(',', array_fill(0, count($segmentIds), '?'));
        $stmt = $db->prepare("SELECT segment_id, COUNT(*) as used FROM spin_pool WHERE customer_id = ? AND segment_id IN ($placeholders) AND is_used = 1 GROUP BY segment_id");
        $stmt->execute(array_merge([$customerId], $segmentIds));
        foreach ($stmt->fetchAll() as $row) {
            $poolCounts[$row['segment_id']] = intval($row['used']);
        }
    }

    $segmentStats = [];
    foreach ($segmentRows as $seg) {
        $usedCount = $poolCounts[$seg['id']] ?? 0;
        $maxCount = intval($seg['max_count']);
        $isUnlimited = intval($seg['unlimited']) === 1;
        $segmentStats[] = [
            'id' => $seg['id'],
            'name' => $seg['name'],
            'color' => $seg['color'],
            'win_text' => $seg['win_text'],
            'weight' => intval($seg['weight']),
            'image' => $seg['image'],
            'theme' => $seg['theme'] ?? 'neutral',
            'sort_order' => intval($seg['sort_order']),
            'max_count' => $maxCount,
            'unlimited' => intval($seg['unlimited']),
            'depleted_behavior' => $seg['depleted_behavior'] ?? 'hide',
            'is_respin' => intval($seg['is_respin']),
            'image_offset_x' => $seg['image_offset_x'] ?? 0,
            'image_offset_y' => $seg['image_offset_y'] ?? 0,
            'image_rotation' => $seg['image_rotation'] ?? 0,
            'image_scale' => $seg['image_scale'] ?? 1,
            'used_count' => $usedCount,
            'remaining' => $isUnlimited ? null : max(0, $maxCount - $usedCount)
        ];
    }

    // Gewinnverteilung
    $stmt = $db->prepare("SELECT segment_name, COUNT(*) as count FROM spins WHERE customer_id = ? GROUP BY segment_name ORDER BY count DESC");
    $stmt->execute([$customerId]);
    $distribution = $stmt->fetchAll();

    // Alle Spins (Drehverlauf)
    $stmt = $db->prepare("SELECT s.segment_name, s.win_text, s.created_at, seg.color
        FROM spins s
        LEFT JOIN segments seg ON s.segment_id = seg.id AND seg.customer_id = ?
        WHERE s.customer_id = ?
        ORDER BY s.created_at DESC");
    $stmt->execute([$customerId, $customerId]);
    $recentSpins = $stmt->fetchAll();

    // Lead-Statistiken
    $stmt = $db->prepare("SELECT COUNT(*) as lead_count FROM leads WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $leadCount = intval($stmt->fetch()['lead_count'] ?? 0);

    $stmt = $db->prepare("SELECT COUNT(*) as spin_count FROM spins WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $spinCount = intval($stmt->fetch()['spin_count'] ?? 0);

    $stmt = $db->prepare("SELECT COUNT(*) as with_lead FROM spins WHERE customer_id = ? AND lead_id IS NOT NULL");
    $stmt->execute([$customerId]);
    $spinsWithLead = intval($stmt->fetch()['with_lead'] ?? 0);

    $conversionRate = $spinCount > 0 ? round(($spinsWithLead / $spinCount) * 100, 1) : 0;

    // Top-Gewinne (nur Spins mit Lead)
    $stmt = $db->prepare("SELECT s.segment_name, COUNT(*) as count 
        FROM spins s 
        WHERE s.customer_id = ? AND s.lead_id IS NOT NULL 
        GROUP BY s.segment_name 
        ORDER BY count DESC 
        LIMIT 5");
    $stmt->execute([$customerId]);
    $topLeadPrizes = $stmt->fetchAll();

    jsonResponse([
        'total_spins' => $usedPool,
        'total_spins_limit' => $totalPool,
        'remaining_spins' => $remaining,
        'campaign_status' => $campaignStatus,
        'campaign_started_at' => $campaignSettings['campaign_started_at'] ?? null,
        'progress_percent' => $progressPercent,
        'active_segments' => $activeSegments,
        'segment_stats' => $segmentStats,
        'distribution' => $distribution,
        'recent_spins' => $recentSpins,
        'lead_stats' => [
            'lead_count' => $leadCount,
            'spin_count' => $spinCount,
            'spins_with_lead' => $spinsWithLead,
            'spins_without_lead' => $spinCount - $spinsWithLead,
            'conversion_rate' => $conversionRate,
            'top_lead_prizes' => $topLeadPrizes
        ]
    ]);
}
