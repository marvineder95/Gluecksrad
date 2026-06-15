<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// GET /api/stats - Statistiken abrufen
if ($method === 'GET') {
    // Rate-Limiting: max. 30 Requests pro Minute pro IP
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    checkRateLimit('stats:' . $clientIp, 30, 60);
    
    // Pool-Statistiken
    $stmt = $db->query("SELECT COUNT(*) as total FROM spin_pool");
    $totalPool = intval($stmt->fetch()['total'] ?? 0);
    
    $stmt = $db->query("SELECT COUNT(*) as used FROM spin_pool WHERE is_used = 1");
    $usedPool = intval($stmt->fetch()['used'] ?? 0);
    
    $remaining = max(0, $totalPool - $usedPool);
    $progressPercent = $totalPool > 0 ? round(($usedPool / $totalPool) * 100, 1) : 0;

    // Kampagnen-Status
    $stmt = $db->query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('campaign_status', 'campaign_started_at')");
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
    $stmt = $db->query("SELECT COUNT(*) as count FROM segments WHERE is_active = 1");
    $activeSegments = intval($stmt->fetch()['count']);

    // Aktive Segmente laden
    $stmt = $db->query("SELECT id, name, color, win_text, weight, image, theme, sort_order, max_count FROM segments WHERE is_active = 1 ORDER BY sort_order, id");
    $segmentRows = $stmt->fetchAll();

    // Pool-Counts pro Segment auf einmal holen
    $segmentIds = array_column($segmentRows, 'id');
    $poolCounts = [];
    if (!empty($segmentIds)) {
        $placeholders = implode(',', array_fill(0, count($segmentIds), '?'));
        $stmt = $db->prepare("SELECT segment_id, COUNT(*) as used FROM spin_pool WHERE segment_id IN ($placeholders) AND is_used = 1 GROUP BY segment_id");
        $stmt->execute($segmentIds);
        foreach ($stmt->fetchAll() as $row) {
            $poolCounts[$row['segment_id']] = intval($row['used']);
        }
    }

    $segmentStats = [];
    foreach ($segmentRows as $seg) {
        $usedCount = $poolCounts[$seg['id']] ?? 0;
        $maxCount = intval($seg['max_count']);
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
            'used_count' => $usedCount,
            'remaining' => max(0, $maxCount - $usedCount)
        ];
    }

    // Gewinnverteilung
    $stmt = $db->query("SELECT segment_name, COUNT(*) as count FROM spins GROUP BY segment_name ORDER BY count DESC");
    $distribution = $stmt->fetchAll();

    // Alle Spins (Drehverlauf)
    $stmt = $db->query("SELECT s.segment_name, s.win_text, s.created_at, seg.color
        FROM spins s
        LEFT JOIN segments seg ON s.segment_id = seg.id
        ORDER BY s.created_at DESC");
    $recentSpins = $stmt->fetchAll();

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
        'recent_spins' => $recentSpins
    ]);
}
