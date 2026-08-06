// Package pool kapselt die gesamte spin_pool-Logik an einer Stelle
// (ein Besitzer). Port aus backend/utils/pool.php und den Pool-Helfern in
// backend/api/segments.php.
//
// Modell-Unterschied zum PHP-Original: Scope ist campaign_id (nicht customer_id).
// Alle Pool-Abfragen sind auf campaign_id gescoped.
//
// Für die sensiblen Abfragen wird bewusst rohes SQL über gorm verwendet
// (db.Raw().Scan() / db.Exec()), um ORM-Magie zu vermeiden.
package pool

import (
	"math/rand"

	"gorm.io/gorm"
)

// GenerateForCampaign erzeugt den Pool aus den aktiven, NICHT-unlimited
// Segmenten einer Kampagne. Port von generateSpinPool().
//
// Für jedes aktive Segment mit max_count > 0 und unlimited = false werden
// max_count Pool-Einträge erzeugt. Die Reihenfolge (sequence_order) wird
// wie im PHP über einen gemischten Pool vergeben, sodass die Segmente
// zufällig durchmischt sind.
//
// Rückgabe: Anzahl erzeugter Pool-Einträge.
func GenerateForCampaign(db *gorm.DB, campaignID uint64) (int, error) {
	type segRow struct {
		ID       uint64
		MaxCount int
	}
	var segs []segRow
	if err := db.Raw(`
		SELECT id, max_count
		FROM segments
		WHERE campaign_id = ?
		  AND is_active = TRUE
		  AND max_count > 0
		  AND unlimited = FALSE
	`, campaignID).Scan(&segs).Error; err != nil {
		return 0, err
	}

	// Pool wie im PHP flach aufbauen: pro Segment max_count Einträge.
	var poolSegmentIDs []uint64
	for _, s := range segs {
		for i := 0; i < s.MaxCount; i++ {
			poolSegmentIDs = append(poolSegmentIDs, s.ID)
		}
	}
	if len(poolSegmentIDs) == 0 {
		return 0, nil
	}

	// shuffle($pool) — Segmente durchmischen.
	rand.Shuffle(len(poolSegmentIDs), func(i, j int) {
		poolSegmentIDs[i], poolSegmentIDs[j] = poolSegmentIDs[j], poolSegmentIDs[i]
	})

	// Batch-Insert mit sequence_order = Index im gemischten Pool.
	for order, segmentID := range poolSegmentIDs {
		if err := db.Exec(`
			INSERT INTO spin_pool (campaign_id, segment_id, sequence_order, is_used)
			VALUES (?, ?, ?, FALSE)
		`, campaignID, segmentID, order).Error; err != nil {
			return 0, err
		}
	}

	return len(poolSegmentIDs), nil
}

// AdjustForSegment passt die Anzahl der (unbenutzten) Pool-Einträge eines
// Segments an das neue max_count an. Port von adjustPoolForSegment().
//
// Bereits benutzte Einträge werden nicht angetastet; es werden nur unbenutzte
// Einträge hinzugefügt oder gelöscht, sodass die Summe (used + unused) das
// Ziel-max_count erreicht (bzw. mindestens die bereits verbrauchten Einträge).
func AdjustForSegment(db *gorm.DB, campaignID, segmentID uint64, newMaxCount int) error {
	var usedCount int
	if err := db.Raw(`
		SELECT COUNT(*) FROM spin_pool
		WHERE campaign_id = ? AND segment_id = ? AND is_used = TRUE
	`, campaignID, segmentID).Scan(&usedCount).Error; err != nil {
		return err
	}

	var unusedCount int
	if err := db.Raw(`
		SELECT COUNT(*) FROM spin_pool
		WHERE campaign_id = ? AND segment_id = ? AND is_used = FALSE
	`, campaignID, segmentID).Scan(&unusedCount).Error; err != nil {
		return err
	}

	// Benötigte unbenutzte Einträge (nie negativ).
	neededUnused := newMaxCount - usedCount
	if neededUnused < 0 {
		neededUnused = 0
	}

	switch {
	case unusedCount > neededUnused:
		// Überschüssige unbenutzte Einträge löschen (die mit höchstem sequence_order).
		toDelete := unusedCount - neededUnused
		if err := db.Exec(`
			DELETE FROM spin_pool
			WHERE id IN (
				SELECT id FROM spin_pool
				WHERE campaign_id = ? AND segment_id = ? AND is_used = FALSE
				ORDER BY sequence_order DESC
				LIMIT ?
			)
		`, campaignID, segmentID, toDelete).Error; err != nil {
			return err
		}
	case unusedCount < neededUnused:
		// Fehlende Einträge hinzufügen. sequence_order fortlaufend ab globalem Maximum.
		toAdd := neededUnused - unusedCount
		var maxOrder int
		if err := db.Raw(`
			SELECT COALESCE(MAX(sequence_order), 0) FROM spin_pool
			WHERE campaign_id = ?
		`, campaignID).Scan(&maxOrder).Error; err != nil {
			return err
		}
		for i := 0; i < toAdd; i++ {
			maxOrder++
			if err := db.Exec(`
				INSERT INTO spin_pool (campaign_id, segment_id, sequence_order, is_used)
				VALUES (?, ?, ?, FALSE)
			`, campaignID, segmentID, maxOrder).Error; err != nil {
				return err
			}
		}
	}
	// Gleich: nichts tun.
	return nil
}

// RemainingBySegment liefert die Anzahl der NICHT benutzten Pool-Einträge
// je Segment (segment_id → remaining). Grundlage für Kandidaten-/Depleted-Logik.
func RemainingBySegment(db *gorm.DB, campaignID uint64) (map[uint64]int, error) {
	type row struct {
		SegmentID uint64
		C         int
	}
	var rows []row
	if err := db.Raw(`
		SELECT segment_id, COUNT(*) AS c
		FROM spin_pool
		WHERE campaign_id = ? AND is_used = FALSE
		GROUP BY segment_id
	`, campaignID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint64]int, len(rows))
	for _, r := range rows {
		out[r.SegmentID] = r.C
	}
	return out, nil
}

// RemoveUnusedForSegment löscht alle unbenutzten Pool-Einträge eines Segments
// (für Soft-Delete eines Segments). Port von removeUnusedPoolEntries().
func RemoveUnusedForSegment(db *gorm.DB, campaignID, segmentID uint64) error {
	return db.Exec(`
		DELETE FROM spin_pool
		WHERE campaign_id = ? AND segment_id = ? AND is_used = FALSE
	`, campaignID, segmentID).Error
}
