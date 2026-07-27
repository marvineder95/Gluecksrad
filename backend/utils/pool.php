<?php
// Hilfsfunktion: Pool aus aktiven Segmenten generieren
function generateSpinPool($db, $customerId) {
    $stmt = $db->prepare("SELECT id, max_count FROM segments WHERE customer_id = ? AND is_active = 1 AND max_count > 0");
    $stmt->execute([$customerId]);
    $segments = $stmt->fetchAll();

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

    $stmt = $db->prepare("INSERT INTO spin_pool (customer_id, segment_id, sequence_order) VALUES (?, ?, ?)");
    foreach ($pool as $order => $segmentId) {
        $stmt->execute([$customerId, $segmentId, $order]);
    }

    return count($pool);
}
