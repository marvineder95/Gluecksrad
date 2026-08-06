package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	appdb "gluecksrad/server/internal/db"
	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"

	"gorm.io/gorm"
)

// ─── Test-Harness (Integrationstests gegen die Docker-Postgres) ──────────────

var (
	testDBOnce sync.Once
	testDB     *gorm.DB
	testDBErr  error
)

func dsn() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "host=localhost port=5433 user=gluecksrad password=dev_password dbname=gluecksrad sslmode=disable"
}

// openTestDB verbindet einmalig zur DB und stellt sicher, dass das Schema existiert.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	testDBOnce.Do(func() {
		testDB, testDBErr = appdb.Open(dsn(), false)
		if testDBErr != nil {
			return
		}
		// Schema sicherstellen (goose-Migrationen sind idempotent).
		if err := appdb.Migrate(testDB); err != nil {
			// AutoMigrate als Fallback (falls Migrationen schon liefen o. Ä.).
			_ = appdb.AutoMigrate(testDB)
		}
	})
	if testDBErr != nil {
		t.Skipf("DB nicht erreichbar (%v) – Integrationstest übersprungen", testDBErr)
	}
	if testDB == nil {
		t.Skip("DB nicht verfügbar – Integrationstest übersprungen")
	}
	return testDB
}

// testFixture kapselt eine isolierte Kampagne mit Segmenten für einen Test.
type testFixture struct {
	db         *gorm.DB
	customerID uint64
	campaignID uint64
}

// newFixture legt Kunde + Kampagne an und registriert Cleanup (Reihenfolge FK-sicher).
func newFixture(t *testing.T, estimatedSpins int) *testFixture {
	t.Helper()
	db := openTestDB(t)

	cust := models.Customer{CompanyName: "Test", Email: "t@example.com"}
	if err := db.Create(&cust).Error; err != nil {
		t.Fatalf("customer create: %v", err)
	}
	camp := models.Campaign{
		CustomerID:     cust.ID,
		Name:           "TestKampagne",
		Status:         "running",
		OnEmpty:        "end",
		EstimatedSpins: estimatedSpins,
	}
	if err := db.Create(&camp).Error; err != nil {
		t.Fatalf("campaign create: %v", err)
	}

	f := &testFixture{db: db, customerID: cust.ID, campaignID: camp.ID}
	t.Cleanup(func() {
		cid := f.campaignID
		db.Exec(`DELETE FROM spin_pool WHERE campaign_id = ?`, cid)
		db.Exec(`DELETE FROM spins WHERE campaign_id = ?`, cid)
		db.Exec(`DELETE FROM leads WHERE campaign_id = ?`, cid)
		db.Exec(`DELETE FROM settings WHERE campaign_id = ?`, cid)
		db.Exec(`UPDATE campaigns SET default_segment_id = NULL WHERE id = ?`, cid)
		db.Exec(`DELETE FROM segments WHERE campaign_id = ?`, cid)
		db.Exec(`DELETE FROM campaigns WHERE id = ?`, cid)
		db.Exec(`DELETE FROM customers WHERE id = ?`, f.customerID)
	})
	return f
}

// addSegment fügt ein Segment hinzu und liefert seine ID.
func (f *testFixture) addSegment(t *testing.T, name string, sortOrder, maxCount int, unlimited bool, depletedBehavior string, isRespin bool) uint64 {
	t.Helper()
	seg := models.Segment{
		CampaignID:       f.campaignID,
		Name:             name,
		Color:            "#FF6B35",
		WinText:          "win " + name,
		Weight:           100,
		Theme:            "neutral",
		SortOrder:        sortOrder,
		MaxCount:         maxCount,
		Unlimited:        unlimited,
		DepletedBehavior: depletedBehavior,
		IsRespin:         isRespin,
		ImageScale:       1,
		IsActive:         true,
	}
	if err := f.db.Create(&seg).Error; err != nil {
		t.Fatalf("segment create: %v", err)
	}
	return seg.ID
}

// generatePool erzeugt den Pool und liefert die Größe.
func (f *testFixture) generatePool(t *testing.T) int {
	t.Helper()
	n, err := pool.GenerateForCampaign(f.db, f.campaignID)
	if err != nil {
		t.Fatalf("generate pool: %v", err)
	}
	return n
}

// spinResp ist die deserialisierte JSON-Antwort eines POST /api/spin.
type spinResp struct {
	Success       bool           `json:"success"`
	Winner        map[string]any `json:"winner"`
	WinnerIndex   int            `json:"winner_index"`
	TotalSegments int            `json:"total_segments"`
	SpinID        uint64         `json:"spin_id"`
	Error         string         `json:"error"`
	Code          string         `json:"code"`
}

// doSpin führt einen POST /api/spin über den echten Router aus.
func (f *testFixture) doSpin(t *testing.T, query string, body any) (int, spinResp) {
	t.Helper()
	srv := New(f.db)
	handler := srv.Router()

	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	url := fmt.Sprintf("/api/spin?campaign_id=%d", f.campaignID)
	if query != "" {
		url += "&" + query
	}
	req := httptest.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var resp spinResp
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	return rec.Code, resp
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// Genaues Kontingent: ein limitiertes Segment mit max_count=N gewinnt genau
// N-mal und ist danach kein Kandidat mehr → Kampagne endet.
func TestSpin_ExactQuota(t *testing.T) {
	const N = 5
	f := newFixture(t, 100)
	segID := f.addSegment(t, "Limited", 0, N, false, "hide", false)
	if got := f.generatePool(t); got != N {
		t.Fatalf("pool size = %d, want %d", got, N)
	}

	wins := 0
	for i := 0; i < N; i++ {
		code, resp := f.doSpin(t, "", nil)
		if code != http.StatusOK {
			t.Fatalf("spin %d: code=%d resp=%+v", i, code, resp)
		}
		if uint64(resp.Winner["id"].(float64)) != segID {
			t.Fatalf("spin %d: winner id = %v, want %d", i, resp.Winner["id"], segID)
		}
		wins++
	}
	if wins != N {
		t.Fatalf("wins = %d, want %d", wins, N)
	}

	// Pool erschöpft → nächster Dreh muss campaign_ended liefern.
	code, resp := f.doSpin(t, "", nil)
	if code != http.StatusBadRequest || resp.Code != "campaign_ended" {
		t.Fatalf("after quota: code=%d resp=%+v, want 400 campaign_ended", code, resp)
	}

	// Verbraucht: genau N used, 0 unused.
	rem, _ := pool.RemainingBySegment(f.db, f.campaignID)
	if rem[segID] != 0 {
		t.Fatalf("remaining[%d] = %d, want 0", segID, rem[segID])
	}
	var used int64
	f.db.Table("spin_pool").Where("campaign_id = ? AND is_used = TRUE", f.campaignID).Count(&used)
	if used != N {
		t.Fatalf("used pool entries = %d, want %d", used, N)
	}
}

// Unlimited-Segment erschöpft nie und gewinnt in jedem Dreh (einziger Kandidat).
func TestSpin_UnlimitedNeverDepletes(t *testing.T) {
	f := newFixture(t, 100)
	segID := f.addSegment(t, "Unlimited", 0, 0, true, "hide", false)
	if got := f.generatePool(t); got != 0 {
		t.Fatalf("pool size = %d, want 0 (unlimited erzeugt keinen Pool)", got)
	}

	for i := 0; i < 20; i++ {
		code, resp := f.doSpin(t, "", nil)
		if code != http.StatusOK {
			t.Fatalf("spin %d: code=%d resp=%+v", i, code, resp)
		}
		if uint64(resp.Winner["id"].(float64)) != segID {
			t.Fatalf("spin %d: winner id = %v, want %d", i, resp.Winner["id"], segID)
		}
		if resp.Winner["remaining"] != nil {
			t.Fatalf("unlimited remaining should be null, got %v", resp.Winner["remaining"])
		}
		if resp.TotalSegments != 1 {
			t.Fatalf("total_segments = %d, want 1", resp.TotalSegments)
		}
	}
	// Kein Pool wurde verbraucht.
	var used int64
	f.db.Table("spin_pool").Where("campaign_id = ? AND is_used = TRUE", f.campaignID).Count(&used)
	if used != 0 {
		t.Fatalf("used pool entries = %d, want 0", used)
	}
}

// Erschöpfung mit depleted_behavior='hide': sobald ein limitiertes Segment leer ist,
// verschwindet es aus displaySegments → total_segments sinkt und winner_index zeigt
// auf die korrekte Position der gekürzten Liste.
func TestSpin_DepletedHideShrinksDisplay(t *testing.T) {
	f := newFixture(t, 100)
	// Reihenfolge: A(sort0) limited=1 hide, B(sort1) unlimited, C(sort2) limited=1 hide
	aID := f.addSegment(t, "A", 0, 1, false, "hide", false)
	bID := f.addSegment(t, "B", 1, 0, true, "hide", false)
	cID := f.addSegment(t, "C", 2, 1, false, "hide", false)
	_ = cID
	f.generatePool(t)

	// Anfangs sind alle 3 sichtbar.
	// Wir erschöpfen A und C gezielt, indem wir ihre Pool-Einträge als used markieren.
	f.db.Exec(`UPDATE spin_pool SET is_used = TRUE WHERE campaign_id = ? AND segment_id = ?`, f.campaignID, aID)
	f.db.Exec(`UPDATE spin_pool SET is_used = TRUE WHERE campaign_id = ? AND segment_id = ?`, f.campaignID, cID)

	// Jetzt sind A und C depleted+hide → displaySegments = [B] nur.
	code, resp := f.doSpin(t, "", nil)
	if code != http.StatusOK {
		t.Fatalf("code=%d resp=%+v", code, resp)
	}
	if resp.TotalSegments != 1 {
		t.Fatalf("total_segments = %d, want 1 (nur B sichtbar)", resp.TotalSegments)
	}
	if resp.WinnerIndex != 0 {
		t.Fatalf("winner_index = %d, want 0", resp.WinnerIndex)
	}
	if uint64(resp.Winner["id"].(float64)) != bID {
		t.Fatalf("winner id = %v, want B(%d)", resp.Winner["id"], bID)
	}

	// Gegenprobe: nur C erschöpfen, A wieder freigeben → displaySegments = [A, B],
	// winner_index für B muss 1 sein.
	f.db.Exec(`UPDATE spin_pool SET is_used = FALSE WHERE campaign_id = ? AND segment_id = ?`, f.campaignID, aID)
	// estimated_spins niedrig setzen, damit unlimited-Gewicht ~ A-Gewicht (1)
	// und über die Test-Drehs beide Positionen (A@0, B@1) auftreten.
	f.db.Exec(`UPDATE campaigns SET estimated_spins = 2 WHERE id = ?`, f.campaignID)
	// Jetzt: A verfügbar (index0), B unlimited (index1), C hidden.
	// Beide Segmente haben Gewicht 1 → über viele Test-Drehs treten beide Positionen auf.
	sawBIndex1 := false
	sawAIndex0 := false
	for i := 0; i < 40; i++ {
		c, r := f.doSpin(t, "test=1", nil)
		if c != http.StatusOK {
			t.Fatalf("test spin: code=%d resp=%+v", c, r)
		}
		if r.TotalSegments != 2 {
			t.Fatalf("total_segments = %d, want 2 (A,B sichtbar)", r.TotalSegments)
		}
		id := uint64(r.Winner["id"].(float64))
		if id == bID {
			if r.WinnerIndex != 1 {
				t.Fatalf("B winner_index = %d, want 1", r.WinnerIndex)
			}
			sawBIndex1 = true
		}
		if id == aID {
			if r.WinnerIndex != 0 {
				t.Fatalf("A winner_index = %d, want 0", r.WinnerIndex)
			}
			sawAIndex0 = true
		}
	}
	if !sawBIndex1 || !sawAIndex0 {
		t.Fatalf("erwartete beide Positionen zu sehen: A@0=%v B@1=%v", sawAIndex0, sawBIndex1)
	}
}

// Respin-Segment finalisiert den Lead NICHT (lead.spin_id bleibt NULL).
func TestSpin_RespinDoesNotFinalizeLead(t *testing.T) {
	f := newFixture(t, 100)
	segID := f.addSegment(t, "Respin", 0, 3, false, "hide", true)
	f.generatePool(t)

	lead := models.Lead{CampaignID: f.campaignID, Name: "Max", Email: "max@example.com"}
	if err := f.db.Create(&lead).Error; err != nil {
		t.Fatalf("lead create: %v", err)
	}

	code, resp := f.doSpin(t, "", map[string]any{"lead_id": lead.ID})
	if code != http.StatusOK {
		t.Fatalf("code=%d resp=%+v", code, resp)
	}
	if uint64(resp.Winner["id"].(float64)) != segID {
		t.Fatalf("winner id = %v, want %d", resp.Winner["id"], segID)
	}

	var reloaded models.Lead
	if err := f.db.First(&reloaded, lead.ID).Error; err != nil {
		t.Fatalf("reload lead: %v", err)
	}
	if reloaded.SpinID != nil {
		t.Fatalf("lead.spin_id = %v, want NULL (Respin darf Lead nicht finalisieren)", *reloaded.SpinID)
	}
	if reloaded.Prize != "" {
		t.Fatalf("lead.prize = %q, want empty", reloaded.Prize)
	}
}

// Nicht-Respin mit gültigem Lead finalisiert (spin_id + prize gesetzt).
func TestSpin_NonRespinFinalizesLead(t *testing.T) {
	f := newFixture(t, 100)
	segID := f.addSegment(t, "Prize", 0, 3, false, "hide", false)
	f.generatePool(t)

	lead := models.Lead{CampaignID: f.campaignID, Name: "Max", Email: "max@example.com"}
	if err := f.db.Create(&lead).Error; err != nil {
		t.Fatalf("lead create: %v", err)
	}

	code, resp := f.doSpin(t, "", map[string]any{"lead_id": lead.ID})
	if code != http.StatusOK {
		t.Fatalf("code=%d resp=%+v", code, resp)
	}

	var reloaded models.Lead
	f.db.First(&reloaded, lead.ID)
	if reloaded.SpinID == nil || *reloaded.SpinID != resp.SpinID {
		t.Fatalf("lead.spin_id = %v, want %d", reloaded.SpinID, resp.SpinID)
	}
	if reloaded.Prize != "Prize" {
		t.Fatalf("lead.prize = %q, want %q", reloaded.Prize, "Prize")
	}
	_ = segID
}

// Keine Kandidaten (leerer Pool, keine Segmente) → campaign_ended + status ended.
func TestSpin_NoCandidatesEndsCampaign(t *testing.T) {
	f := newFixture(t, 100)
	// Segment mit max_count=1, Pool aber NICHT generiert → remaining=0 → depleted+hide → keine Kandidaten & keine displaySegments.
	f.addSegment(t, "A", 0, 1, false, "hide", false)
	// KEIN generatePool → 0 remaining.

	code, resp := f.doSpin(t, "", nil)
	if code != http.StatusBadRequest || resp.Code != "campaign_ended" {
		t.Fatalf("code=%d resp=%+v, want 400 campaign_ended", code, resp)
	}

	var camp models.Campaign
	f.db.First(&camp, f.campaignID)
	if camp.Status != "ended" {
		t.Fatalf("campaign.status = %q, want ended", camp.Status)
	}
}

// ?test=1 verbraucht keinen Pool und speichert keinen Spin.
func TestSpin_TestModeDoesNotConsume(t *testing.T) {
	const N = 4
	f := newFixture(t, 100)
	segID := f.addSegment(t, "Limited", 0, N, false, "hide", false)
	_ = segID
	f.generatePool(t)

	for i := 0; i < 10; i++ {
		code, resp := f.doSpin(t, "test=1", nil)
		if code != http.StatusOK {
			t.Fatalf("test spin %d: code=%d resp=%+v", i, code, resp)
		}
		if resp.SpinID != 0 {
			t.Fatalf("test spin_id = %d, want 0", resp.SpinID)
		}
	}

	// Nichts verbraucht.
	rem, _ := pool.RemainingBySegment(f.db, f.campaignID)
	if rem[segID] != N {
		t.Fatalf("remaining = %d, want %d (test-Modus darf nicht verbrauchen)", rem[segID], N)
	}
	var spinCount int64
	f.db.Model(&models.Spin{}).Where("campaign_id = ?", f.campaignID).Count(&spinCount)
	if spinCount != 0 {
		t.Fatalf("spins gespeichert = %d, want 0", spinCount)
	}
}

// DELETE /api/spin setzt Kampagne zurück: löscht spins+pool, regeneriert Pool, status=running.
func TestDeleteSpin_ResetsCampaign(t *testing.T) {
	const N = 3
	f := newFixture(t, 100)
	f.addSegment(t, "Limited", 0, N, false, "hide", false)
	f.generatePool(t)

	// Ein paar echte Drehs.
	f.doSpin(t, "", nil)
	f.doSpin(t, "", nil)

	// Kampagne auf ended + einen super_admin-Token bereitstellen.
	f.db.Model(&models.Campaign{}).Where("id = ?", f.campaignID).Update("status", "ended")

	token := "testtoken_" + fmt.Sprint(f.campaignID)
	admin := models.User{Email: fmt.Sprintf("admin+%d@example.com", f.campaignID), PasswordHash: "x", Role: "super_admin", IsActive: true, APIToken: &token}
	if err := f.db.Create(&admin).Error; err != nil {
		t.Fatalf("admin create: %v", err)
	}
	t.Cleanup(func() { f.db.Exec(`DELETE FROM users WHERE id = ?`, admin.ID) })

	srv := New(f.db)
	handler := srv.Router()
	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/spin?campaign_id=%d", f.campaignID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("delete code = %d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["pool_size"].(float64) != N {
		t.Fatalf("pool_size = %v, want %d", out["pool_size"], N)
	}

	var camp models.Campaign
	f.db.First(&camp, f.campaignID)
	if camp.Status != "running" {
		t.Fatalf("status = %q, want running", camp.Status)
	}
	var spinCount, usedCount int64
	f.db.Model(&models.Spin{}).Where("campaign_id = ?", f.campaignID).Count(&spinCount)
	f.db.Table("spin_pool").Where("campaign_id = ? AND is_used = TRUE", f.campaignID).Count(&usedCount)
	if spinCount != 0 {
		t.Fatalf("spins after reset = %d, want 0", spinCount)
	}
	if usedCount != 0 {
		t.Fatalf("used pool after reset = %d, want 0", usedCount)
	}
}
