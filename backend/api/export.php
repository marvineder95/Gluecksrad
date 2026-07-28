<?php
require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../utils/export_writers.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') {
    jsonResponse(['error' => 'Methode nicht erlaubt'], 405);
}

requireCustomerAdmin();
$db = getDB();
$customerId = requireCustomerContext();

// Freischaltung prüfen (kostenpflichtiges Feature, nur vom Super-Admin aktivierbar)
$stmt = $db->prepare("SELECT company_name, export_enabled FROM customers WHERE id = ?");
$stmt->execute([$customerId]);
$customer = $stmt->fetch();
if (!$customer || intval($customer['export_enabled']) !== 1) {
    jsonResponse(['error' => 'Export ist für diesen Account nicht freigeschaltet.'], 403);
}

$type = $_GET['type'] ?? 'leads';        // leads | stats
$format = $_GET['format'] ?? 'xlsx';     // xlsx | pdf
if (!in_array($type, ['leads', 'stats'], true)) $type = 'leads';
if (!in_array($format, ['xlsx', 'pdf'], true)) $format = 'xlsx';

$company = $customer['company_name'] ?: 'Point4Spin';
$dateStr = date('Y-m-d');

function fmtDateTime($s) {
    if (!$s) return '';
    $ts = strtotime($s);
    return $ts ? date('d.m.Y H:i', $ts) : $s;
}

// === Daten sammeln ===

if ($type === 'leads') {
    $stmt = $db->prepare("SELECT name, email, prize, consent_given, data, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC");
    $stmt->execute([$customerId]);
    $leads = $stmt->fetchAll();

    // Vereinigung aller Zusatzfeld-Spalten
    $extraCols = [];
    $parsed = [];
    foreach ($leads as $l) {
        $extra = [];
        if (!empty($l['data'])) {
            $d = json_decode($l['data'], true);
            if (is_array($d)) $extra = $d;
        }
        foreach ($extra as $k => $v) {
            if (!in_array($k, $extraCols, true)) $extraCols[] = $k;
        }
        $parsed[] = ['lead' => $l, 'extra' => $extra];
    }

    $headers = array_merge(['Name', 'E-Mail'], $extraCols, ['Gewinn', 'Einwilligung', 'Datum']);
    $rows = [];
    foreach ($parsed as $p) {
        $l = $p['lead'];
        $row = [$l['name'], $l['email']];
        foreach ($extraCols as $k) {
            $row[] = isset($p['extra'][$k]) ? (string)$p['extra'][$k] : '';
        }
        $row[] = $l['prize'] ?: '-';
        $row[] = intval($l['consent_given']) ? 'Ja' : 'Nein';
        $row[] = fmtDateTime($l['created_at']);
        $rows[] = $row;
    }

    $filenameBase = 'leads_' . $dateStr;

    if ($format === 'xlsx') {
        $sheet = array_merge([$headers], $rows);
        $binary = build_xlsx(['Leads' => $sheet]);
        sendFile($binary, $filenameBase . '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
        $pdf = new SimplePdf();
        $pdf->title('Leads – ' . $company);
        $pdf->subtitle('Exportiert am ' . date('d.m.Y H:i') . '  ·  ' . count($rows) . ' Einträge');
        $pdf->spacer(8);
        // Spaltengewichte: Name/Mail breiter
        $weights = array_fill(0, count($headers), 1);
        if (count($headers) > 0) $weights[0] = 1.4;
        if (count($headers) > 1) $weights[1] = 1.8;
        $pdf->table($headers, $rows, $weights);
        sendFile($pdf->output(), $filenameBase . '.pdf', 'application/pdf');
    }
}

if ($type === 'stats') {
    // Pool
    $stmt = $db->prepare("SELECT COUNT(*) t FROM spin_pool WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $totalPool = intval($stmt->fetch()['t'] ?? 0);
    $stmt = $db->prepare("SELECT COUNT(*) u FROM spin_pool WHERE customer_id = ? AND is_used = 1");
    $stmt->execute([$customerId]);
    $usedPool = intval($stmt->fetch()['u'] ?? 0);
    $remaining = max(0, $totalPool - $usedPool);

    // Segmentstatistik
    $stmt = $db->prepare("SELECT id, name, max_count, unlimited, is_respin FROM segments WHERE customer_id = ? AND is_active = 1 ORDER BY sort_order, id");
    $stmt->execute([$customerId]);
    $segs = $stmt->fetchAll();
    $poolCounts = [];
    $ids = array_column($segs, 'id');
    if (!empty($ids)) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("SELECT segment_id, COUNT(*) used FROM spin_pool WHERE customer_id = ? AND segment_id IN ($ph) AND is_used = 1 GROUP BY segment_id");
        $stmt->execute(array_merge([$customerId], $ids));
        foreach ($stmt->fetchAll() as $r) $poolCounts[$r['segment_id']] = intval($r['used']);
    }

    // Lead-Kennzahlen
    $stmt = $db->prepare("SELECT COUNT(*) c FROM leads WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $leadCount = intval($stmt->fetch()['c'] ?? 0);
    $stmt = $db->prepare("SELECT COUNT(*) c FROM spins WHERE customer_id = ?");
    $stmt->execute([$customerId]);
    $spinCount = intval($stmt->fetch()['c'] ?? 0);
    $stmt = $db->prepare("SELECT COUNT(*) c FROM spins WHERE customer_id = ? AND lead_id IS NOT NULL");
    $stmt->execute([$customerId]);
    $spinsWithLead = intval($stmt->fetch()['c'] ?? 0);
    $conversion = $spinCount > 0 ? round(($spinsWithLead / $spinCount) * 100, 1) : 0;

    // Zusammenfassung als Zeilen
    $summary = [
        ['Kennzahl', 'Wert'],
        ['Gedrehte Runden', (string)$usedPool],
        ['Geplante Runden gesamt', (string)$totalPool],
        ['Verbleibende Runden', (string)$remaining],
        ['Erfasste Leads', (string)$leadCount],
        ['Drehungen mit Lead', (string)$spinsWithLead],
        ['Conversion-Rate', $conversion . ' %'],
    ];

    // Segmenttabelle
    $segHeaders = ['Segment', 'Gewonnen', 'Kontingent', 'Verbleibend', 'Typ'];
    $segRows = [];
    foreach ($segs as $s) {
        $used = $poolCounts[$s['id']] ?? 0;
        $isUnlimited = intval($s['unlimited']) === 1;
        $type2 = intval($s['is_respin']) ? 'Nochmal drehen' : ($isUnlimited ? 'Unbegrenzt' : 'Gewinn');
        $segRows[] = [
            $s['name'],
            (string)$used,
            $isUnlimited ? '∞' : (string)intval($s['max_count']),
            $isUnlimited ? '∞' : (string)max(0, intval($s['max_count']) - $used),
            $type2
        ];
    }

    $filenameBase = 'statistik_' . $dateStr;

    if ($format === 'xlsx') {
        $binary = build_xlsx([
            'Zusammenfassung' => $summary,
            'Segmente' => array_merge([$segHeaders], $segRows)
        ]);
        sendFile($binary, $filenameBase . '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
        $pdf = new SimplePdf();
        $pdf->title('Statistik – ' . $company);
        $pdf->subtitle('Exportiert am ' . date('d.m.Y H:i'));
        $pdf->spacer(8);
        $pdf->table(['Kennzahl', 'Wert'], array_slice($summary, 1), [2, 1]);
        $pdf->spacer(6);
        $pdf->subtitle('Segmente', 12);
        $pdf->table($segHeaders, $segRows, [2, 1, 1, 1, 1.3]);
        sendFile($pdf->output(), $filenameBase . '.pdf', 'application/pdf');
    }
}

function sendFile($binary, $filename, $mime) {
    // JSON-Header aus bootstrap überschreiben
    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($binary));
    header('Cache-Control: no-store');
    // CSP mit Attachment nicht relevant; direkt ausgeben
    echo $binary;
    exit;
}
