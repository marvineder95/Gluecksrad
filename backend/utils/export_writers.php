<?php
// === Datei-Generatoren für Export (XLSX + PDF), ohne externe Bibliotheken ===

// --- Hilfsfunktionen ---

function xlsxColLetter($index) {
    // 0-basiert -> A, B, ... Z, AA, ...
    $letter = '';
    $index++;
    while ($index > 0) {
        $mod = ($index - 1) % 26;
        $letter = chr(65 + $mod) . $letter;
        $index = intval(($index - $mod) / 26);
    }
    return $letter;
}

function xlsxEsc($s) {
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

/**
 * Erzeugt eine .xlsx-Datei (binär) aus mehreren Blättern.
 * $sheets: ['Blattname' => [ [zelle, zelle, ...], ... ], ...]
 * Die erste Zeile jedes Blatts wird als fette Kopfzeile formatiert.
 */
function build_xlsx(array $sheets) {
    if (empty($sheets)) { $sheets = ['Tabelle1' => [[]]]; }

    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);

    // [Content_Types].xml
    $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    $sheetIdx = 1;
    foreach ($sheets as $name => $rows) {
        $ct .= '<Override PartName="/xl/worksheets/sheet' . $sheetIdx . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        $sheetIdx++;
    }
    $ct .= '</Types>';
    $zip->addFromString('[Content_Types].xml', $ct);

    // _rels/.rels
    $zip->addFromString('_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        . '</Relationships>');

    // xl/styles.xml – zwei Zellformate: 0=normal, 1=fett (Kopfzeile)
    $zip->addFromString('xl/styles.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        . '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="2">'
        . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '</cellXfs>'
        . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        . '</styleSheet>');

    // xl/workbook.xml + rels
    $wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    $sheetIdx = 1;
    foreach ($sheets as $name => $rows) {
        $safeName = mb_substr(preg_replace('/[\\\\\/\?\*\[\]:]/u', ' ', (string)$name), 0, 31, 'UTF-8');
        if ($safeName === '') $safeName = 'Tabelle' . $sheetIdx;
        $wb .= '<sheet name="' . xlsxEsc($safeName) . '" sheetId="' . $sheetIdx . '" r:id="rId' . $sheetIdx . '"/>';
        $rels .= '<Relationship Id="rId' . $sheetIdx . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $sheetIdx . '.xml"/>';
        $sheetIdx++;
    }
    $wb .= '</sheets></workbook>';
    // styles-Relationship anhängen
    $rels .= '<Relationship Id="rId' . $sheetIdx . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    $rels .= '</Relationships>';
    $zip->addFromString('xl/workbook.xml', $wb);
    $zip->addFromString('xl/_rels/workbook.xml.rels', $rels);

    // Blätter
    $sheetIdx = 1;
    foreach ($sheets as $name => $rows) {
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
        $r = 1;
        foreach ($rows as $row) {
            $xml .= '<row r="' . $r . '">';
            $c = 0;
            foreach ($row as $cell) {
                $ref = xlsxColLetter($c) . $r;
                $styleAttr = ($r === 1) ? ' s="1"' : '';
                if (is_int($cell) || is_float($cell) || (is_string($cell) && $cell !== '' && preg_match('/^-?\d+(\.\d+)?$/', $cell))) {
                    $xml .= '<c r="' . $ref . '"' . $styleAttr . '><v>' . xlsxEsc($cell) . '</v></c>';
                } else {
                    $xml .= '<c r="' . $ref . '" t="inlineStr"' . $styleAttr . '><is><t xml:space="preserve">' . xlsxEsc($cell) . '</t></is></c>';
                }
                $c++;
            }
            $xml .= '</row>';
            $r++;
        }
        $xml .= '</sheetData></worksheet>';
        $zip->addFromString('xl/worksheets/sheet' . $sheetIdx . '.xml', $xml);
        $sheetIdx++;
    }

    $zip->close();
    $data = file_get_contents($tmp);
    @unlink($tmp);
    return $data;
}

/**
 * Minimaler PDF-Generator (Helvetica, WinAnsi) mit Titel und Tabellen inkl. Seitenumbruch.
 */
class SimplePdf {
    private $pageW = 595.28;   // A4 Breite (pt)
    private $pageH = 841.89;   // A4 Höhe (pt)
    private $margin = 40;
    private $y;
    private $pages = [];       // Content-Streams je Seite
    private $current = '';

    public function __construct() {
        $this->newPage();
    }

    private function enc($s) {
        // UTF-8 -> Windows-1252, damit Umlaute in Helvetica korrekt erscheinen
        $s = (string)$s;
        if (function_exists('mb_convert_encoding')) {
            $conv = @mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
        } else {
            $conv = @iconv('UTF-8', 'Windows-1252//TRANSLIT', $s);
        }
        if ($conv === false || $conv === null) $conv = $s;
        // PDF-String-Escapes
        $conv = str_replace(['\\', '(', ')', "\r", "\n"], ['\\\\', '\\(', '\\)', '', ' '], $conv);
        return $conv;
    }

    private function newPage() {
        if ($this->current !== '') $this->pages[] = $this->current;
        $this->current = '';
        $this->y = $this->pageH - $this->margin;
    }

    private function ensureSpace($needed) {
        if ($this->y - $needed < $this->margin) {
            $this->newPage();
        }
    }

    private function textWidth($str, $size) {
        // grobe Näherung: Helvetica Durchschnittsbreite ~0.52em
        return mb_strlen($str, 'UTF-8') * $size * 0.52;
    }

    private function fit($str, $size, $maxW) {
        $str = (string)$str;
        if ($this->textWidth($str, $size) <= $maxW) return $str;
        while (mb_strlen($str, 'UTF-8') > 1 && $this->textWidth($str . '…', $size) > $maxW) {
            $str = mb_substr($str, 0, mb_strlen($str, 'UTF-8') - 1, 'UTF-8');
        }
        return $str . '…';
    }

    public function drawText($x, $y, $str, $size = 10, $bold = false) {
        $font = $bold ? '/F2' : '/F1';
        $this->current .= "BT $font $size Tf $x $y Td (" . $this->enc($str) . ") Tj ET\n";
    }

    public function title($str, $size = 18) {
        $this->ensureSpace($size + 12);
        $this->y -= $size;
        $this->drawText($this->margin, $this->y, $str, $size, true);
        $this->y -= 12;
    }

    public function subtitle($str, $size = 10) {
        $this->ensureSpace($size + 8);
        $this->y -= $size;
        $this->drawText($this->margin, $this->y, $str, $size, false);
        $this->y -= 8;
    }

    private function hline($y) {
        $x1 = $this->margin;
        $x2 = $this->pageW - $this->margin;
        $this->current .= "0.8 w 0.75 0.75 0.75 RG $x1 $y m $x2 $y l S\n";
    }

    /**
     * Zeichnet eine Tabelle. $headers: string[]; $rows: array von string[].
     * $weights: relative Spaltenbreiten (optional).
     */
    public function table($headers, $rows, $weights = null) {
        $n = count($headers);
        if ($n === 0) return;
        $usableW = $this->pageW - 2 * $this->margin;
        if (!$weights || count($weights) !== $n) {
            $weights = array_fill(0, $n, 1);
        }
        $sum = array_sum($weights);
        $colW = [];
        for ($i = 0; $i < $n; $i++) $colW[$i] = $usableW * ($weights[$i] / $sum);

        $rowH = 16;
        $fontSize = 9;
        $pad = 3;

        $drawHeader = function() use ($headers, $colW, $n, $rowH, $fontSize, $pad) {
            $this->ensureSpace($rowH + 4);
            $this->y -= rowHeightMarker($rowH);
            $x = $this->margin;
            for ($i = 0; $i < $n; $i++) {
                $txt = $this->fit($headers[$i], $fontSize, $colW[$i] - 2 * $pad);
                $this->drawText($x + $pad, $this->y + 4, $txt, $fontSize, true);
                $x += $colW[$i];
            }
            $this->hline($this->y);
        };

        $drawHeader();

        foreach ($rows as $row) {
            if ($this->y - $rowH < $this->margin) {
                $this->newPage();
                $drawHeader();
            }
            $this->y -= $rowH;
            $x = $this->margin;
            for ($i = 0; $i < $n; $i++) {
                $val = isset($row[$i]) ? $row[$i] : '';
                $txt = $this->fit($val, $fontSize, $colW[$i] - 2 * $pad);
                $this->drawText($x + $pad, $this->y + 4, $txt, $fontSize, false);
                $x += $colW[$i];
            }
            $this->hline($this->y);
        }
        $this->y -= 10;
    }

    public function spacer($h = 14) {
        $this->y -= $h;
    }

    public function output() {
        // aktuelle Seite finalisieren
        if ($this->current !== '') { $this->pages[] = $this->current; $this->current = ''; }
        if (empty($this->pages)) $this->pages[] = '';

        $objects = [];
        // 1: Catalog, 2: Pages, dann pro Seite: Page + Content, am Ende zwei Fonts
        $nPages = count($this->pages);
        $pageObjIds = [];
        $contentObjIds = [];
        $objId = 3;
        for ($i = 0; $i < $nPages; $i++) {
            $pageObjIds[] = $objId++;
            $contentObjIds[] = $objId++;
        }
        $fontRegularId = $objId++;
        $fontBoldId = $objId++;

        // Catalog
        $objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        // Pages
        $kids = implode(' ', array_map(function($id){ return "$id 0 R"; }, $pageObjIds));
        $objects[2] = "<< /Type /Pages /Count $nPages /Kids [ $kids ] >>";

        for ($i = 0; $i < $nPages; $i++) {
            $pid = $pageObjIds[$i];
            $cid = $contentObjIds[$i];
            $objects[$pid] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {$this->pageW} {$this->pageH}] "
                . "/Resources << /Font << /F1 $fontRegularId 0 R /F2 $fontBoldId 0 R >> >> /Contents $cid 0 R >>";
            $stream = $this->pages[$i];
            $len = strlen($stream);
            $objects[$cid] = "<< /Length $len >>\nstream\n" . $stream . "endstream";
        }
        $objects[$fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
        $objects[$fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

        // PDF zusammenbauen mit xref
        ksort($objects);
        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        $maxId = max(array_keys($objects));
        for ($id = 1; $id <= $maxId; $id++) {
            if (!isset($objects[$id])) continue;
            $offsets[$id] = strlen($pdf);
            $pdf .= "$id 0 obj\n" . $objects[$id] . "\nendobj\n";
        }
        $xrefPos = strlen($pdf);
        $count = $maxId + 1;
        $pdf .= "xref\n0 $count\n";
        $pdf .= "0000000000 65535 f \n";
        for ($id = 1; $id <= $maxId; $id++) {
            if (isset($offsets[$id])) {
                $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
            } else {
                $pdf .= "0000000000 65535 f \n";
            }
        }
        $pdf .= "trailer\n<< /Size $count /Root 1 0 R >>\nstartxref\n$xrefPos\n%%EOF";
        return $pdf;
    }
}

// kleiner Helfer, damit die Kopfzeile denselben Vorschub wie eine Datenzeile nutzt
function rowHeightMarker($h) { return $h; }
