<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

// Hilfsfunktion: Pool-Einträge für ein Segment anpassen
function adjustPoolForSegment($db, $customerId, $segmentId, $newMaxCount) {
    // Bereits verbrauchte Einträge
    $stmt = $db->prepare("SELECT COUNT(*) as used FROM spin_pool WHERE customer_id = ? AND segment_id = ? AND is_used = 1");
    $stmt->execute([$customerId, $segmentId]);
    $usedCount = intval($stmt->fetch()['used']);

    // Unbenutzte Einträge
    $stmt = $db->prepare("SELECT COUNT(*) as unused FROM spin_pool WHERE customer_id = ? AND segment_id = ? AND is_used = 0");
    $stmt->execute([$customerId, $segmentId]);
    $unusedCount = intval($stmt->fetch()['unused']);

    // Benötigte unbenutzte Einträge (darf nicht negativ sein)
    $neededUnused = max(0, $newMaxCount - $usedCount);

    if ($unusedCount > $neededUnused) {
        // Zu viele unbenutzte Einträge -> überschüssige löschen
        $toDelete = $unusedCount - $neededUnused;
        $stmt = $db->prepare("DELETE FROM spin_pool WHERE id IN (
            SELECT id FROM spin_pool WHERE customer_id = ? AND segment_id = ? AND is_used = 0 ORDER BY sequence_order DESC LIMIT ?
        )");
        $stmt->execute([$customerId, $segmentId, $toDelete]);
    } elseif ($unusedCount < $neededUnused) {
        // Zu wenige unbenutzte Einträge -> neue hinzufügen
        $toAdd = $neededUnused - $unusedCount;
        $stmt = $db->query("SELECT COALESCE(MAX(sequence_order), 0) as max_order FROM spin_pool");
        $maxOrder = intval($stmt->fetch()['max_order']);

        $insert = $db->prepare("INSERT INTO spin_pool (customer_id, segment_id, sequence_order) VALUES (?, ?, ?)");
        for ($i = 0; $i < $toAdd; $i++) {
            $maxOrder++;
            $insert->execute([$customerId, $segmentId, $maxOrder]);
        }
    }
    // Wenn gleich: nichts tun
}

// Hilfsfunktion: Alle unbenutzten Pool-Einträge eines Segments entfernen
function removeUnusedPoolEntries($db, $customerId, $segmentId) {
    $stmt = $db->prepare("DELETE FROM spin_pool WHERE customer_id = ? AND segment_id = ? AND is_used = 0");
    $stmt->execute([$customerId, $segmentId]);
}

// GET /api/segments - Alle Segmente abrufen
if ($method === 'GET') {
    $customerId = getCurrentCustomerId();
    if ($customerId === null || $customerId <= 0) {
        jsonResponse([]);
    }
    $stmt = $db->prepare("SELECT id, name, color, win_text, weight, icon, image, theme, sort_order, max_count, image_offset_x, image_offset_y, image_rotation, image_scale, is_active FROM segments WHERE customer_id = ? AND is_active = 1 ORDER BY sort_order, id");
    $stmt->execute([$customerId]);
    jsonResponse($stmt->fetchAll());
}

// POST /api/segments - Neues Segment erstellen oder Update (wenn id vorhanden)
if ($method === 'POST') {
    requireCustomerAdmin();
    validateCsrf();

    $customerId = requireCustomerContext();
    $id = intval($_GET['id'] ?? 0);
    $data = $_POST;
    $name = sanitizeText($data['name'] ?? '');
    $win_text = sanitizeText($data['win_text'] ?? '');
    $weight = intval($data['weight'] ?? 100);
    $sort_order = intval($data['sort_order'] ?? 0);
    $max_count = intval($data['max_count'] ?? 0);
    $theme = sanitizeText($data['theme'] ?? 'neutral');
    $imageOffsetX = floatval($data['image_offset_x'] ?? 0);
    $imageOffsetY = floatval($data['image_offset_y'] ?? 0);
    $imageRotation = floatval($data['image_rotation'] ?? 0);
    $imageScale = floatval($data['image_scale'] ?? 1);
    // Sicherheitsbegrenzung für Editor-Offsets
    $imageOffsetX = max(-5000, min(5000, $imageOffsetX));
    $imageOffsetY = max(-5000, min(5000, $imageOffsetY));
    $imageRotation = max(-360, min(360, $imageRotation));
    $imageScale = max(0.1, min(5, $imageScale));

    if (empty($name)) {
        jsonResponse(['error' => 'Name ist erforderlich'], 400);
    }

    if ($max_count < 1) {
        jsonResponse(['error' => 'Anzahl in Kampagne muss mindestens 1 sein. Unbegrenzte Segmente sind nicht mehr erlaubt.'], 400);
    }

    // Optional: Prüfen, ob bestehendes Segment dem Kunden gehört
    if ($id) {
        $stmt = $db->prepare("SELECT id FROM segments WHERE customer_id = ? AND id = ? AND is_active = 1");
        $stmt->execute([$customerId, $id]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Segment nicht gefunden'], 404);
        }
    }

    // Handle segment image upload
    $imagePath = null;
    $removeBg = !empty($data['remove_bg']) && $data['remove_bg'] !== '0' && $data['remove_bg'] !== 'false';

    if (!empty($data['existing_image'])) {
        $imagePath = validateExistingImagePath($data['existing_image']);
        if ($imagePath === null) {
            jsonResponse(['error' => 'Ungültiger Bildpfad'], 400);
        }
    }

    // Check for upload errors first
    if (!empty($_FILES['segment_image'])) {
        if ($_FILES['segment_image']['error'] !== UPLOAD_ERR_OK) {
            $errorMsg = 'Upload-Fehler';
            switch ($_FILES['segment_image']['error']) {
                case UPLOAD_ERR_INI_SIZE: $errorMsg = 'Datei zu groß (max 20 MB)'; break;
                case UPLOAD_ERR_FORM_SIZE: $errorMsg = 'Datei zu groß'; break;
                case UPLOAD_ERR_PARTIAL: $errorMsg = 'Datei nur teilweise hochgeladen'; break;
                case UPLOAD_ERR_NO_FILE: $errorMsg = 'Keine Datei hochgeladen'; break;
            }
            jsonResponse(['error' => $errorMsg], 400);
        }

        $validation = validateImageUpload($_FILES['segment_image']);
        if (!$validation['valid']) {
            jsonResponse(['error' => $validation['error']], 400);
        }

        $uploadDir = getCustomerUploadDir('segments');
        $filepath = $uploadDir . $validation['safeName'];
        move_uploaded_file($_FILES['segment_image']['tmp_name'], $filepath);
        optimizeImage($filepath, $filepath, 800, 800, 85);
        $imagePath = getCustomerUploadUrl('segments', $validation['safeName']);

        // Remove background if requested
        if ($removeBg) {
            $venvPython = __DIR__ . '/../../venv/bin/python3';
            $script = __DIR__ . '/../utils/remove_bg.py';
            $outputName = pathinfo($validation['safeName'], PATHINFO_FILENAME) . '_nobg.png';
            $outputPath = $uploadDir . $outputName;

            if (file_exists($venvPython) && file_exists($script)) {
                $cmd = escapeshellcmd($venvPython) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($filepath) . ' ' . escapeshellarg($outputPath) . ' 2>&1';
                exec($cmd, $output, $exitCode);
                if ($exitCode === 0 && file_exists($outputPath)) {
                    $imagePath = getCustomerUploadUrl('segments', $outputName);
                }
            }
        }
    }

    $db->beginTransaction();
    try {
        if ($id) {
            // Bestehendes max_count holen, um Änderung zu erkennen
            $stmt = $db->prepare("SELECT max_count FROM segments WHERE customer_id = ? AND id = ?");
            $stmt->execute([$customerId, $id]);
            $oldSegment = $stmt->fetch();
            $oldMaxCount = $oldSegment ? intval($oldSegment['max_count']) : 0;

            if ($imagePath !== null) {
                $stmt = $db->prepare("UPDATE segments SET name = ?, win_text = ?, weight = ?, sort_order = ?, max_count = ?, theme = ?, image = ?, image_offset_x = ?, image_offset_y = ?, image_rotation = ?, image_scale = ? WHERE customer_id = ? AND id = ?");
                $stmt->execute([$name, $win_text, $weight, $sort_order, $max_count, $theme, $imagePath, $imageOffsetX, $imageOffsetY, $imageRotation, $imageScale, $customerId, $id]);
            } else {
                $stmt = $db->prepare("UPDATE segments SET name = ?, win_text = ?, weight = ?, sort_order = ?, max_count = ?, theme = ?, image_offset_x = ?, image_offset_y = ?, image_rotation = ?, image_scale = ? WHERE customer_id = ? AND id = ?");
                $stmt->execute([$name, $win_text, $weight, $sort_order, $max_count, $theme, $imageOffsetX, $imageOffsetY, $imageRotation, $imageScale, $customerId, $id]);
            }

            // Pool anpassen, falls sich max_count geändert hat
            if ($oldMaxCount !== $max_count) {
                adjustPoolForSegment($db, $customerId, $id, $max_count);
            }
        } else {
            $stmt = $db->prepare("INSERT INTO segments (customer_id, name, win_text, weight, image, theme, sort_order, max_count, image_offset_x, image_offset_y, image_rotation, image_scale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$customerId, $name, $win_text, $weight, $imagePath, $theme, $sort_order, $max_count, $imageOffsetX, $imageOffsetY, $imageRotation, $imageScale]);
            $id = $db->lastInsertId();

            // Neue Pool-Einträge für das neue Segment
            adjustPoolForSegment($db, $customerId, $id, $max_count);
        }

        $db->commit();

        // Kampagnenstatus ggf. aktualisieren (z.B. wenn max_count erhöht wurde)
        updateCampaignStatus($db, $customerId);

        jsonResponse(['success' => true, 'id' => $id]);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Speichern: ' . $e->getMessage()], 500);
    }
}

// PUT /api/segments - Bulk sort_order update (Drag & Drop)
if ($method === 'PUT') {
    requireCustomerAdmin();
    validateCsrf();

    $customerId = requireCustomerContext();
    $data = json_decode(file_get_contents('php://input'), true);
    $orders = $data['orders'] ?? [];

    if (empty($orders) || !is_array($orders)) {
        jsonResponse(['error' => 'Ungültige Daten'], 400);
    }

    // Optional: Prüfen, ob alle IDs zum Kunden gehören
    $ids = array_map('intval', array_column($orders, 'id'));
    if (!empty($ids)) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("SELECT COUNT(*) as c FROM segments WHERE customer_id = ? AND id IN ($placeholders)");
        $stmt->execute(array_merge([$customerId], $ids));
        $allowedCount = intval($stmt->fetch()['c']);
        if ($allowedCount !== count($ids)) {
            jsonResponse(['error' => 'Ungültige Segment-IDs'], 403);
        }
    }

    $db->beginTransaction();
    try {
        $stmt = $db->prepare("UPDATE segments SET sort_order = ? WHERE customer_id = ? AND id = ?");
        foreach ($orders as $item) {
            $stmt->execute([intval($item['sort_order']), $customerId, intval($item['id'])]);
        }
        $db->commit();
        jsonResponse(['success' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Sortieren'], 500);
    }
}

// DELETE /api/segments/{id} - Segment löschen (soft delete)
if ($method === 'DELETE') {
    requireCustomerAdmin();
    validateCsrf();

    $customerId = requireCustomerContext();
    $id = intval($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID erforderlich'], 400);

    $db->beginTransaction();
    try {
        // Unbenutzte Pool-Einträge entfernen
        removeUnusedPoolEntries($db, $customerId, $id);

        $stmt = $db->prepare("UPDATE segments SET is_active = 0 WHERE customer_id = ? AND id = ?");
        $stmt->execute([$customerId, $id]);

        $db->commit();
        jsonResponse(['success' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        jsonResponse(['error' => 'Fehler beim Löschen'], 500);
    }
}
