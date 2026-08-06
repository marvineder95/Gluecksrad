package pool_test

import (
	"os"
	"testing"

	appdb "gluecksrad/server/internal/db"
	"gluecksrad/server/internal/models"
	"gluecksrad/server/internal/pool"

	"gorm.io/gorm"
)

func dsn() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "host=localhost port=5433 user=gluecksrad password=dev_password dbname=gluecksrad sslmode=disable"
}

func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := appdb.Open(dsn(), false)
	if err != nil {
		t.Skipf("DB nicht erreichbar (%v)", err)
	}
	if err := appdb.Migrate(db); err != nil {
		_ = appdb.AutoMigrate(db)
	}
	return db
}

// setup legt Kunde + Kampagne an und liefert campaignID + Cleanup.
func setup(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()
	cust := models.Customer{CompanyName: "PoolTest", Email: "pool@example.com"}
	if err := db.Create(&cust).Error; err != nil {
		t.Fatalf("customer: %v", err)
	}
	camp := models.Campaign{CustomerID: cust.ID, Name: "C", Status: "running", OnEmpty: "end", EstimatedSpins: 100}
	if err := db.Create(&camp).Error; err != nil {
		t.Fatalf("campaign: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM spin_pool WHERE campaign_id = ?`, camp.ID)
		db.Exec(`DELETE FROM segments WHERE campaign_id = ?`, camp.ID)
		db.Exec(`DELETE FROM campaigns WHERE id = ?`, camp.ID)
		db.Exec(`DELETE FROM customers WHERE id = ?`, cust.ID)
	})
	return camp.ID
}

func addSegment(t *testing.T, db *gorm.DB, campaignID uint64, maxCount int, unlimited bool) uint64 {
	t.Helper()
	seg := models.Segment{
		CampaignID: campaignID, Name: "S", Color: "#FF6B35", Weight: 100, Theme: "neutral",
		MaxCount: maxCount, Unlimited: unlimited, DepletedBehavior: "hide", ImageScale: 1, IsActive: true,
	}
	if err := db.Create(&seg).Error; err != nil {
		t.Fatalf("segment: %v", err)
	}
	return seg.ID
}

func TestGenerateForCampaign(t *testing.T) {
	db := openDB(t)
	campID := setup(t, db)
	addSegment(t, db, campID, 3, false)
	addSegment(t, db, campID, 5, false)
	addSegment(t, db, campID, 0, true)  // unlimited → keine Einträge
	addSegment(t, db, campID, 0, false) // max_count=0 → keine Einträge

	n, err := pool.GenerateForCampaign(db, campID)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if n != 8 {
		t.Fatalf("pool size = %d, want 8", n)
	}
	rem, _ := pool.RemainingBySegment(db, campID)
	total := 0
	for _, v := range rem {
		total += v
	}
	if total != 8 {
		t.Fatalf("remaining total = %d, want 8", total)
	}
}

func TestAdjustForSegment_GrowAndShrink(t *testing.T) {
	db := openDB(t)
	campID := setup(t, db)
	segID := addSegment(t, db, campID, 4, false)

	// Anfangs anlegen: 4.
	if err := pool.AdjustForSegment(db, campID, segID, 4); err != nil {
		t.Fatalf("adjust to 4: %v", err)
	}
	if got := remaining(t, db, campID, segID); got != 4 {
		t.Fatalf("remaining = %d, want 4", got)
	}

	// Ein Eintrag als used markieren, dann auf 2 verkleinern.
	db.Exec(`UPDATE spin_pool SET is_used = TRUE WHERE campaign_id = ? AND segment_id = ? AND id = (
		SELECT id FROM spin_pool WHERE campaign_id = ? AND segment_id = ? LIMIT 1)`, campID, segID, campID, segID)

	if err := pool.AdjustForSegment(db, campID, segID, 2); err != nil {
		t.Fatalf("adjust to 2: %v", err)
	}
	// used=1, unused soll 1 sein (2 - 1 used).
	if got := remaining(t, db, campID, segID); got != 1 {
		t.Fatalf("after shrink remaining = %d, want 1", got)
	}

	// Wachsen auf 6 → used=1, unused=5.
	if err := pool.AdjustForSegment(db, campID, segID, 6); err != nil {
		t.Fatalf("adjust to 6: %v", err)
	}
	if got := remaining(t, db, campID, segID); got != 5 {
		t.Fatalf("after grow remaining = %d, want 5", got)
	}

	// Ziel unter used → neededUnused=0. used=1, setze max_count=0 → unused=0.
	if err := pool.AdjustForSegment(db, campID, segID, 0); err != nil {
		t.Fatalf("adjust to 0: %v", err)
	}
	if got := remaining(t, db, campID, segID); got != 0 {
		t.Fatalf("after zero remaining = %d, want 0", got)
	}
	var used int64
	db.Table("spin_pool").Where("campaign_id = ? AND segment_id = ? AND is_used = TRUE", campID, segID).Count(&used)
	if used != 1 {
		t.Fatalf("used = %d, want 1 (benutzte Einträge bleiben)", used)
	}
}

func TestRemoveUnusedForSegment(t *testing.T) {
	db := openDB(t)
	campID := setup(t, db)
	segID := addSegment(t, db, campID, 5, false)
	if err := pool.AdjustForSegment(db, campID, segID, 5); err != nil {
		t.Fatalf("adjust: %v", err)
	}
	// 2 als used markieren.
	db.Exec(`UPDATE spin_pool SET is_used = TRUE WHERE id IN (
		SELECT id FROM spin_pool WHERE campaign_id = ? AND segment_id = ? LIMIT 2)`, campID, segID)

	if err := pool.RemoveUnusedForSegment(db, campID, segID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if got := remaining(t, db, campID, segID); got != 0 {
		t.Fatalf("remaining = %d, want 0", got)
	}
	var used int64
	db.Table("spin_pool").Where("campaign_id = ? AND segment_id = ? AND is_used = TRUE", campID, segID).Count(&used)
	if used != 2 {
		t.Fatalf("used = %d, want 2", used)
	}
}

func remaining(t *testing.T, db *gorm.DB, campID, segID uint64) int {
	t.Helper()
	rem, err := pool.RemainingBySegment(db, campID)
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	return rem[segID]
}
