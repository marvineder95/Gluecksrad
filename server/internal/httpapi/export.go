package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	gofpdf "github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"
)

// routeExport montiert den Export-Endpunkt.
//
// Auth-Regeln (aus export.php):
//   - GET /api/export  → requireAuth (customer_admin / super_admin)
//     Zusätzlich: customers.export_enabled muss true sein (kostenpflichtiges Feature).
//
// Query-Parameter:
//   - ?type=leads|stats   (default: leads)
//   - ?format=xlsx|pdf    (default: xlsx)
//   - ?campaign_id=
//
// Scope: campaign_id (Phase 1).
func (s *Server) routeExport(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(s.requireAuth)
		pr.Get("/api/export", s.handleGetExport)
	})
}

// GET /api/export?campaign_id=&type=leads&format=xlsx
func (s *Server) handleGetExport(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Nicht authentifiziert")
		return
	}

	// Kampagne validieren und Ownership prüfen
	campaignID, err := s.campaignFromRequest(r, user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Kampagne laden (CustomerID benötigt für Gating-Prüfung)
	var campaign models.Campaign
	if err := s.DB.First(&campaign, campaignID).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden der kampagne")
		return
	}

	// Gating: Export ist ein kostenpflichtiges Feature.
	// Zugehörigen Kunden laden und export_enabled prüfen.
	var customer models.Customer
	if err := s.DB.First(&customer, campaign.CustomerID).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden des kunden")
		return
	}
	if !customer.ExportEnabled {
		writeError(w, http.StatusForbidden, "Export ist für diesen Account nicht freigeschaltet.")
		return
	}

	// Query-Parameter auslesen und normalisieren
	exportType := r.URL.Query().Get("type")
	if exportType != "leads" && exportType != "stats" {
		exportType = "leads"
	}
	format := r.URL.Query().Get("format")
	if format != "xlsx" && format != "pdf" {
		format = "xlsx"
	}

	dateStr := time.Now().Format("2006-01-02")
	company := customer.CompanyName
	if company == "" {
		company = "Point4Spin"
	}

	switch exportType {
	case "leads":
		s.exportLeads(w, campaignID, format, dateStr, company)
	case "stats":
		s.exportStats(w, campaignID, format, dateStr, company)
	}
}

// fmtDateTime formatiert einen time.Time-Wert im deutschen Datumsformat.
func fmtDateTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("02.01.2006 15:04")
}

// sendFile schreibt Datei-Bytes mit korrekten HTTP-Headern.
func sendFile(w http.ResponseWriter, data []byte, filename, mime string) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// exportLeads erstellt den Leads-Export (xlsx oder pdf) für eine Kampagne.
func (s *Server) exportLeads(w http.ResponseWriter, campaignID uint64, format, dateStr, company string) {
	// Leads laden
	var leads []models.Lead
	if err := s.DB.Where("campaign_id = ?", campaignID).
		Order("created_at DESC").
		Find(&leads).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden der leads")
		return
	}

	// Dynamische Zusatzspalten: Vereinigung aller Schlüssel aus Lead.Data (JSONB)
	// Reihenfolge: erste Erscheinung entscheidet.
	extraColsIndex := make(map[string]int) // key → Index in extraCols
	var extraCols []string
	type parsedLead struct {
		lead  models.Lead
		extra map[string]interface{}
	}
	parsed := make([]parsedLead, 0, len(leads))
	for _, l := range leads {
		extra := make(map[string]interface{})
		if len(l.Data) > 0 {
			_ = json.Unmarshal([]byte(l.Data), &extra)
		}
		for k := range extra {
			if _, exists := extraColsIndex[k]; !exists {
				extraColsIndex[k] = len(extraCols)
				extraCols = append(extraCols, k)
			}
		}
		parsed = append(parsed, parsedLead{lead: l, extra: extra})
	}

	// Spalten: Name, E-Mail, <dynamische Felder>, Gewinn, Einwilligung, Datum
	headers := make([]string, 0, 4+len(extraCols))
	headers = append(headers, "Name", "E-Mail")
	headers = append(headers, extraCols...)
	headers = append(headers, "Gewinn", "Einwilligung", "Datum")

	// Zeilen aufbauen
	rows := make([][]string, 0, len(parsed))
	for _, p := range parsed {
		row := make([]string, 0, len(headers))
		row = append(row, p.lead.Name, p.lead.Email)
		for _, k := range extraCols {
			if v, ok := p.extra[k]; ok {
				row = append(row, fmt.Sprintf("%v", v))
			} else {
				row = append(row, "")
			}
		}
		prize := p.lead.Prize
		if prize == "" {
			prize = "-"
		}
		consent := "Nein"
		if p.lead.ConsentGiven {
			consent = "Ja"
		}
		row = append(row, prize, consent, fmtDateTime(p.lead.CreatedAt))
		rows = append(rows, row)
	}

	filenameBase := "leads_" + dateStr

	if format == "xlsx" {
		data, err := buildLeadsXLSX(headers, rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Fehler beim erzeugen der XLSX-Datei")
			return
		}
		sendFile(w, data, filenameBase+".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	} else {
		title := "Leads – " + company
		subtitle := fmt.Sprintf("Exportiert am %s  ·  %d Einträge",
			time.Now().Format("02.01.2006 15:04"), len(rows))

		// Spaltengewichte: Name etwas breiter, E-Mail noch breiter
		weights := make([]float64, len(headers))
		for i := range weights {
			weights[i] = 1.0
		}
		if len(weights) > 0 {
			weights[0] = 1.4 // Name
		}
		if len(weights) > 1 {
			weights[1] = 1.8 // E-Mail
		}

		data, err := buildPDF(title, subtitle, headers, rows, weights)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Fehler beim erzeugen der PDF-Datei")
			return
		}
		sendFile(w, data, filenameBase+".pdf", "application/pdf")
	}
}

// exportStats erstellt den Statistik-Export (xlsx oder pdf) für eine Kampagne.
func (s *Server) exportStats(w http.ResponseWriter, campaignID uint64, format, dateStr, company string) {
	// Pool-Zahlen: gesamt und verwendet (campaign-scoped)
	var totalPool int64
	s.DB.Model(&models.SpinPool{}).Where("campaign_id = ?", campaignID).Count(&totalPool)

	var usedPool int64
	s.DB.Model(&models.SpinPool{}).Where("campaign_id = ? AND is_used = TRUE", campaignID).Count(&usedPool)

	remaining := totalPool - usedPool
	if remaining < 0 {
		remaining = 0
	}

	// Lead-Kennzahlen
	var leadCount int64
	s.DB.Model(&models.Lead{}).Where("campaign_id = ?", campaignID).Count(&leadCount)

	var spinCount int64
	s.DB.Model(&models.Spin{}).Where("campaign_id = ?", campaignID).Count(&spinCount)

	var spinsWithLead int64
	s.DB.Model(&models.Spin{}).Where("campaign_id = ? AND lead_id IS NOT NULL", campaignID).Count(&spinsWithLead)

	var conversion float64
	if spinCount > 0 {
		conversion = float64(spinsWithLead) / float64(spinCount) * 100.0
		// Auf eine Dezimalstelle runden
		conversion = float64(int(conversion*10+0.5)) / 10
	}

	// Zusammenfassung (Zeilen ohne Kopfzeile; Kopfzeile wird separat behandelt)
	summaryHeader := []string{"Kennzahl", "Wert"}
	summaryRows := [][]string{
		{"Gedrehte Runden", fmt.Sprintf("%d", usedPool)},
		{"Geplante Runden gesamt", fmt.Sprintf("%d", totalPool)},
		{"Verbleibende Runden", fmt.Sprintf("%d", remaining)},
		{"Erfasste Leads", fmt.Sprintf("%d", leadCount)},
		{"Drehungen mit Lead", fmt.Sprintf("%d", spinsWithLead)},
		{"Conversion-Rate", fmt.Sprintf("%.1f %%", conversion)},
	}

	// Aktive Segmente laden
	var segs []models.Segment
	if err := s.DB.Where("campaign_id = ? AND is_active = TRUE", campaignID).
		Order("sort_order, id").
		Find(&segs).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden der segmente")
		return
	}

	// Verbleibende Pool-Einträge je Segment
	remainingMap, err := pool.RemainingBySegment(s.DB, campaignID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim laden der pool-daten")
		return
	}

	// Verwendete Pool-Einträge je Segment
	type segUsedRow struct {
		SegmentID uint64
		Used      int
	}
	var usedRows []segUsedRow
	s.DB.Raw(`
		SELECT segment_id, COUNT(*) AS used
		FROM spin_pool
		WHERE campaign_id = ? AND is_used = TRUE
		GROUP BY segment_id
	`, campaignID).Scan(&usedRows)
	usedBySegment := make(map[uint64]int, len(usedRows))
	for _, r := range usedRows {
		usedBySegment[r.SegmentID] = r.Used
	}

	segHeaders := []string{"Segment", "Gewonnen", "Kontingent", "Verbleibend", "Typ"}
	segRows := make([][]string, 0, len(segs))
	for _, seg := range segs {
		usedSeg := usedBySegment[seg.ID]
		remainingSeg := remainingMap[seg.ID]

		var kontingent, verbleibend string
		if seg.Unlimited {
			kontingent = "∞"
			verbleibend = "∞"
		} else {
			kontingent = fmt.Sprintf("%d", seg.MaxCount)
			verbleibend = fmt.Sprintf("%d", remainingSeg)
		}

		var typ string
		switch {
		case seg.IsRespin:
			typ = "Nochmal drehen"
		case seg.Unlimited:
			typ = "Unbegrenzt"
		default:
			typ = "Gewinn"
		}

		segRows = append(segRows, []string{
			seg.Name,
			fmt.Sprintf("%d", usedSeg),
			kontingent,
			verbleibend,
			typ,
		})
	}

	filenameBase := "statistik_" + dateStr

	if format == "xlsx" {
		// Zwei Sheets: Zusammenfassung und Segmente
		data, err := buildStatsXLSX(summaryHeader, summaryRows, segHeaders, segRows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Fehler beim erzeugen der XLSX-Datei")
			return
		}
		sendFile(w, data, filenameBase+".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	} else {
		title := "Statistik – " + company
		subtitle := "Exportiert am " + time.Now().Format("02.01.2006 15:04")

		data, err := buildStatsPDF(title, subtitle, summaryHeader, summaryRows, segHeaders, segRows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Fehler beim erzeugen der PDF-Datei")
			return
		}
		sendFile(w, data, filenameBase+".pdf", "application/pdf")
	}
}

// ─── XLSX-Builder ────────────────────────────────────────────────────────────

// buildLeadsXLSX erzeugt eine XLSX-Datei mit einem "Leads"-Sheet.
// Die erste Zeile (Kopfzeile) wird fett formatiert.
func buildLeadsXLSX(headers []string, rows [][]string) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close() //nolint:errcheck

	sheet := "Leads"
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}

	// Fett-Style für Kopfzeile
	boldStyle, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true},
	})
	if err != nil {
		return nil, err
	}

	// Kopfzeile schreiben
	for col, h := range headers {
		cell, err := excelize.CoordinatesToCellName(col+1, 1)
		if err != nil {
			return nil, err
		}
		if err := f.SetCellValue(sheet, cell, h); err != nil {
			return nil, err
		}
		if err := f.SetCellStyle(sheet, cell, cell, boldStyle); err != nil {
			return nil, err
		}
	}

	// Datenzeilen schreiben
	for rowIdx, row := range rows {
		for col, val := range row {
			cell, err := excelize.CoordinatesToCellName(col+1, rowIdx+2)
			if err != nil {
				return nil, err
			}
			if err := f.SetCellValue(sheet, cell, val); err != nil {
				return nil, err
			}
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// buildStatsXLSX erzeugt eine XLSX-Datei mit zwei Sheets: Zusammenfassung und Segmente.
func buildStatsXLSX(summaryHeader []string, summaryRows [][]string, segHeaders []string, segRows [][]string) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close() //nolint:errcheck

	boldStyle, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true},
	})
	if err != nil {
		return nil, err
	}

	writeSheet := func(sheetName string, headers []string, rows [][]string) error {
		if _, err := f.NewSheet(sheetName); err != nil {
			return err
		}

		// Kopfzeile
		for col, h := range headers {
			cell, err := excelize.CoordinatesToCellName(col+1, 1)
			if err != nil {
				return err
			}
			if err := f.SetCellValue(sheetName, cell, h); err != nil {
				return err
			}
			if err := f.SetCellStyle(sheetName, cell, cell, boldStyle); err != nil {
				return err
			}
		}

		// Daten
		for rowIdx, row := range rows {
			for col, val := range row {
				cell, err := excelize.CoordinatesToCellName(col+1, rowIdx+2)
				if err != nil {
					return err
				}
				if err := f.SetCellValue(sheetName, cell, val); err != nil {
					return err
				}
			}
		}
		return nil
	}

	// Erstes Sheet umbenennen und befüllen.
	// "Sheet1" existiert bereits — direkt beschreiben, dann umbenennen.
	if err := writeSheet("Sheet1", summaryHeader, summaryRows); err != nil {
		return nil, err
	}
	if err := f.SetSheetName("Sheet1", "Zusammenfassung"); err != nil {
		return nil, err
	}
	// Zweites Sheet anlegen und befüllen.
	if err := writeSheet("Segmente", segHeaders, segRows); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ─── PDF-Builder ─────────────────────────────────────────────────────────────

const (
	pdfFontFamily = "Arial"
	pdfPageW      = 277.0 // A4 landscape width in mm
	pdfMargin     = 10.0
	pdfBodyW      = pdfPageW - 2*pdfMargin
)

// buildPDF erzeugt ein einfaches PDF mit Titel, Untertitel und einer Tabelle.
// weights legt die relativen Spaltenbreiten fest (Summe beliebig; wird normalisiert).
func buildPDF(title, subtitle string, headers []string, rows [][]string, weights []float64) ([]byte, error) {
	pdf := gofpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(pdfMargin, pdfMargin, pdfMargin)
	pdf.AddPage()

	// Titel
	pdf.SetFont(pdfFontFamily, "B", 16)
	pdf.CellFormat(pdfBodyW, 10, title, "", 1, "L", false, 0, "")

	// Untertitel
	pdf.SetFont(pdfFontFamily, "", 10)
	pdf.CellFormat(pdfBodyW, 6, subtitle, "", 1, "L", false, 0, "")
	pdf.Ln(6)

	// Tabelle zeichnen
	if err := pdfTable(pdf, headers, rows, weights); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// buildStatsPDF erzeugt ein PDF mit zwei Tabellen: Zusammenfassung und Segmente.
func buildStatsPDF(title, subtitle string, summaryHeader []string, summaryRows [][]string, segHeaders []string, segRows [][]string) ([]byte, error) {
	pdf := gofpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(pdfMargin, pdfMargin, pdfMargin)
	pdf.AddPage()

	// Titel
	pdf.SetFont(pdfFontFamily, "B", 16)
	pdf.CellFormat(pdfBodyW, 10, title, "", 1, "L", false, 0, "")

	// Untertitel
	pdf.SetFont(pdfFontFamily, "", 10)
	pdf.CellFormat(pdfBodyW, 6, subtitle, "", 1, "L", false, 0, "")
	pdf.Ln(6)

	// Zusammenfassung: Kennzahl-Spalte doppelt so breit wie Wert-Spalte
	summaryWeights := []float64{2.0, 1.0}
	if err := pdfTable(pdf, summaryHeader, summaryRows, summaryWeights); err != nil {
		return nil, err
	}
	pdf.Ln(6)

	// Segment-Abschnitt
	pdf.SetFont(pdfFontFamily, "B", 12)
	pdf.CellFormat(pdfBodyW, 7, "Segmente", "", 1, "L", false, 0, "")
	pdf.Ln(2)

	// Segment-Spaltengewichte (wie im PHP): [2, 1, 1, 1, 1.3]
	segWeights := []float64{2.0, 1.0, 1.0, 1.0, 1.3}
	if err := pdfTable(pdf, segHeaders, segRows, segWeights); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// pdfTable zeichnet eine Tabelle mit automatischer Paginierung.
// Neue Seite wird eingefügt, wenn die nächste Zeile nicht mehr auf die aktuelle passt.
func pdfTable(pdf *gofpdf.Fpdf, headers []string, rows [][]string, weights []float64) error {
	if len(headers) == 0 {
		return nil
	}

	// Gewichte normalisieren → Spaltenbreiten berechnen
	colWidths := normalizeWeights(weights, len(headers), pdfBodyW)

	const rowH = 7.0
	const headerH = 8.0

	// Hilfsfunktion: Kopfzeile zeichnen
	drawHeader := func() {
		pdf.SetFont(pdfFontFamily, "B", 9)
		pdf.SetFillColor(220, 220, 220)
		for i, h := range headers {
			pdf.CellFormat(colWidths[i], headerH, h, "1", 0, "L", true, 0, "")
		}
		pdf.Ln(-1)
	}

	drawHeader()

	pdf.SetFont(pdfFontFamily, "", 9)
	pdf.SetFillColor(255, 255, 255)

	for _, row := range rows {
		// Seitenumbruch prüfen
		_, pageH := pdf.GetPageSize()
		if pdf.GetY()+rowH > pageH-pdfMargin {
			pdf.AddPage()
			drawHeader()
			pdf.SetFont(pdfFontFamily, "", 9)
		}

		for i, val := range row {
			if i >= len(colWidths) {
				break
			}
			pdf.CellFormat(colWidths[i], rowH, val, "1", 0, "L", false, 0, "")
		}
		// Fehlende Zellen auffüllen (falls Zeile kürzer als Header)
		for i := len(row); i < len(headers); i++ {
			pdf.CellFormat(colWidths[i], rowH, "", "1", 0, "L", false, 0, "")
		}
		pdf.Ln(-1)
	}

	return nil
}

// normalizeWeights verteilt totalWidth proportional gemäß weights auf n Spalten.
// Fehlende Gewichte werden mit 1.0 aufgefüllt.
func normalizeWeights(weights []float64, n int, totalWidth float64) []float64 {
	w := make([]float64, n)
	var sum float64
	for i := 0; i < n; i++ {
		if i < len(weights) {
			w[i] = weights[i]
		} else {
			w[i] = 1.0
		}
		sum += w[i]
	}
	if sum == 0 {
		sum = float64(n)
		for i := range w {
			w[i] = 1.0
		}
	}
	result := make([]float64, n)
	for i, v := range w {
		result[i] = (v / sum) * totalWidth
	}
	return result
}
