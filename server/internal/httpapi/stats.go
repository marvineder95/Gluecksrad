package httpapi

import (
	"math"
	"net/http"
	"time"

	"gluecksrad/server/internal/models"

	"github.com/go-chi/chi/v5"
)

// routeStats montiert die Stats-Endpunkte.
//
// Auth-Regeln (aus stats.php):
//   - GET /api/stats  → öffentlich (Dashboard pollt ohne gesonderte Auth;
//     PHP prüft nur campaign/customer via Query-Param).
//     Hinweis: sensible Daten (Leads) sind nur in /api/leads (requireAuth).
//
// Scope: campaign_id (Phase 1). Aufrufer nutzt campaignFromRequest().
func (s *Server) routeStats(r chi.Router) {
	r.Get("/api/stats", s.handleGetStats)
}

// segmentStatRow ist die Darstellung eines Segments in segment_stats[].
// Das "remaining"-Feld muss *int sein, damit unlimited-Segmente null liefern.
type segmentStatRow struct {
	ID               uint64  `json:"id"`
	Name             string  `json:"name"`
	Color            string  `json:"color"`
	WinText          string  `json:"win_text"`
	Weight           int     `json:"weight"`
	Image            string  `json:"image"`
	Theme            string  `json:"theme"`
	SortOrder        int     `json:"sort_order"`
	MaxCount         int     `json:"max_count"`
	Unlimited        int     `json:"unlimited"` // 0/1 wie PHP
	DepletedBehavior string  `json:"depleted_behavior"`
	IsRespin         int     `json:"is_respin"` // 0/1 wie PHP
	ImageOffsetX     float64 `json:"image_offset_x"`
	ImageOffsetY     float64 `json:"image_offset_y"`
	ImageRotation    float64 `json:"image_rotation"`
	ImageScale       float64 `json:"image_scale"`
	UsedCount        int     `json:"used_count"`
	Remaining        *int    `json:"remaining"` // null wenn unlimited
}

// distributionRow entspricht {segment_name, count} aus der distribution[]-Liste.
type distributionRow struct {
	SegmentName string `json:"segment_name"`
	Count       int    `json:"count"`
}

// recentSpinRow entspricht {segment_name, win_text, created_at, color} aus recent_spins[].
type recentSpinRow struct {
	SegmentName string    `json:"segment_name"`
	WinText     string    `json:"win_text"`
	CreatedAt   time.Time `json:"created_at"`
	Color       string    `json:"color"`
}

// topLeadPrizeRow entspricht {segment_name, count} aus top_lead_prizes[].
type topLeadPrizeRow struct {
	SegmentName string `json:"segment_name"`
	Count       int    `json:"count"`
}

// leadStats entspricht dem lead_stats-Objekt in der Antwort.
type leadStats struct {
	LeadCount        int               `json:"lead_count"`
	SpinCount        int               `json:"spin_count"`
	SpinsWithLead    int               `json:"spins_with_lead"`
	SpinsWithoutLead int               `json:"spins_without_lead"`
	ConversionRate   float64           `json:"conversion_rate"`
	TopLeadPrizes    []topLeadPrizeRow `json:"top_lead_prizes"`
}

// statsResponse ist das vollständige JSON-Objekt, das der Endpoint liefert —
// 1:1-Mapping zu stats.php jsonResponse([...]).
type statsResponse struct {
	TotalSpins        int               `json:"total_spins"`
	TotalSpinsLimit   int               `json:"total_spins_limit"`
	RemainingSpins    int               `json:"remaining_spins"`
	CampaignStatus    string            `json:"campaign_status"`
	CampaignStartedAt *time.Time        `json:"campaign_started_at"`
	ProgressPercent   float64           `json:"progress_percent"`
	ActiveSegments    int               `json:"active_segments"`
	SegmentStats      []segmentStatRow  `json:"segment_stats"`
	Distribution      []distributionRow `json:"distribution"`
	RecentSpins       []recentSpinRow   `json:"recent_spins"`
	LeadStats         leadStats         `json:"lead_stats"`
}

// GET /api/stats?campaign_id=
//
// Öffentlicher Endpunkt — kein requireAuth. Port von backend/api/stats.php.
// Scope: campaign_id (PHP: customer_id). campaign_started_at kommt aus
// Campaign.StartedAt (PHP: settings.campaign_started_at).
func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	// campaign_id aus Query-String (public, keine Owner-Prüfung).
	campaignID, err := publicCampaignID(r)
	if err != nil {
		// Leere Antwort wie PHP bei fehlendem customer_id.
		writeJSON(w, http.StatusOK, statsResponse{
			CampaignStatus: "running",
			SegmentStats:   []segmentStatRow{},
			Distribution:   []distributionRow{},
			RecentSpins:    []recentSpinRow{},
			LeadStats: leadStats{
				TopLeadPrizes: []topLeadPrizeRow{},
			},
		})
		return
	}

	// Kampagne laden (für Status und StartedAt).
	var campaign models.Campaign
	if err := s.DB.First(&campaign, campaignID).Error; err != nil {
		writeJSON(w, http.StatusOK, statsResponse{
			CampaignStatus: "running",
			SegmentStats:   []segmentStatRow{},
			Distribution:   []distributionRow{},
			RecentSpins:    []recentSpinRow{},
			LeadStats: leadStats{
				TopLeadPrizes: []topLeadPrizeRow{},
			},
		})
		return
	}

	// ── Pool-Statistiken ────────────────────────────────────────────────────────
	// total = alle Pool-Einträge, used = genutzte Pool-Einträge.
	// Port:
	//   SELECT COUNT(*) as total FROM spin_pool WHERE campaign_id = ?
	//   SELECT COUNT(*) as used  FROM spin_pool WHERE campaign_id = ? AND is_used = 1
	var totalPool int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM spin_pool WHERE campaign_id = ?`,
		campaignID,
	).Scan(&totalPool).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (pool total)")
		return
	}

	var usedPool int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM spin_pool WHERE campaign_id = ? AND is_used = TRUE`,
		campaignID,
	).Scan(&usedPool).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (pool used)")
		return
	}

	remaining := totalPool - usedPool
	if remaining < 0 {
		remaining = 0
	}

	progressPercent := 0.0
	if totalPool > 0 {
		progressPercent = math.Round((float64(usedPool)/float64(totalPool))*1000) / 10
	}

	// ── Kampagnen-Status (nur berechnen, nicht schreiben) ───────────────────────
	// Port: $campaignStatus = $campaignSettings['campaign_status'] ?? 'running';
	//       if ($remaining <= 0 && $totalPool > 0) $campaignStatus = 'ended';
	//       elseif ($remaining > 0 && $campaignStatus === 'ended') $campaignStatus = 'running';
	campaignStatus := campaign.Status
	if campaignStatus == "" {
		campaignStatus = "running"
	}
	if remaining <= 0 && totalPool > 0 {
		campaignStatus = "ended"
	} else if remaining > 0 && campaignStatus == "ended" {
		campaignStatus = "running"
	}

	// ── Aktive Segmente zählen ──────────────────────────────────────────────────
	// Port: SELECT COUNT(*) as count FROM segments WHERE campaign_id = ? AND is_active = 1
	var activeSegmentsCount int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM segments WHERE campaign_id = ? AND is_active = TRUE`,
		campaignID,
	).Scan(&activeSegmentsCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (active segments count)")
		return
	}

	// ── Aktive Segmente laden ───────────────────────────────────────────────────
	// Port: SELECT id,name,color,win_text,weight,image,theme,sort_order,max_count,
	//              unlimited,depleted_behavior,is_respin,image_offset_x,image_offset_y,
	//              image_rotation,image_scale
	//       FROM segments WHERE campaign_id = ? AND is_active = 1 ORDER BY sort_order, id
	type segmentDBRow struct {
		ID               uint64  `gorm:"column:id"`
		Name             string  `gorm:"column:name"`
		Color            string  `gorm:"column:color"`
		WinText          string  `gorm:"column:win_text"`
		Weight           int     `gorm:"column:weight"`
		Image            string  `gorm:"column:image"`
		Theme            string  `gorm:"column:theme"`
		SortOrder        int     `gorm:"column:sort_order"`
		MaxCount         int     `gorm:"column:max_count"`
		Unlimited        bool    `gorm:"column:unlimited"`
		DepletedBehavior string  `gorm:"column:depleted_behavior"`
		IsRespin         bool    `gorm:"column:is_respin"`
		ImageOffsetX     float64 `gorm:"column:image_offset_x"`
		ImageOffsetY     float64 `gorm:"column:image_offset_y"`
		ImageRotation    float64 `gorm:"column:image_rotation"`
		ImageScale       float64 `gorm:"column:image_scale"`
	}
	var segmentRows []segmentDBRow
	if err := s.DB.Raw(`
		SELECT id, name, color, win_text, weight, image, theme, sort_order,
		       max_count, unlimited, depleted_behavior, is_respin,
		       image_offset_x, image_offset_y, image_rotation, image_scale
		FROM segments
		WHERE campaign_id = ? AND is_active = TRUE
		ORDER BY sort_order, id
	`, campaignID).Scan(&segmentRows).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (segments)")
		return
	}

	// ── Pool-Counts per Segment (used) ─────────────────────────────────────────
	// Port: SELECT segment_id, COUNT(*) as used
	//       FROM spin_pool WHERE campaign_id = ? AND segment_id IN (...) AND is_used = 1
	//       GROUP BY segment_id
	segmentIDs := make([]uint64, 0, len(segmentRows))
	for _, seg := range segmentRows {
		segmentIDs = append(segmentIDs, seg.ID)
	}

	poolCounts := make(map[uint64]int, len(segmentIDs))
	if len(segmentIDs) > 0 {
		type poolCountRow struct {
			SegmentID uint64 `gorm:"column:segment_id"`
			Used      int    `gorm:"column:used"`
		}
		var poolCountRows []poolCountRow
		if err := s.DB.Raw(`
			SELECT segment_id, COUNT(*) AS used
			FROM spin_pool
			WHERE campaign_id = ? AND segment_id IN ? AND is_used = TRUE
			GROUP BY segment_id
		`, campaignID, segmentIDs).Scan(&poolCountRows).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "Datenbankfehler (pool counts)")
			return
		}
		for _, row := range poolCountRows {
			poolCounts[row.SegmentID] = row.Used
		}
	}

	// ── segment_stats[] aufbauen ────────────────────────────────────────────────
	segmentStats := make([]segmentStatRow, 0, len(segmentRows))
	for _, seg := range segmentRows {
		usedCount := poolCounts[seg.ID]
		isUnlimited := seg.Unlimited

		unlimitedInt := 0
		if isUnlimited {
			unlimitedInt = 1
		}
		isRespinInt := 0
		if seg.IsRespin {
			isRespinInt = 1
		}

		theme := seg.Theme
		if theme == "" {
			theme = "neutral"
		}
		depletedBehavior := seg.DepletedBehavior
		if depletedBehavior == "" {
			depletedBehavior = "hide"
		}
		imageScale := seg.ImageScale
		if imageScale == 0 {
			imageScale = 1
		}

		var remainingPtr *int
		if !isUnlimited {
			r := seg.MaxCount - usedCount
			if r < 0 {
				r = 0
			}
			remainingPtr = &r
		}

		segmentStats = append(segmentStats, segmentStatRow{
			ID:               seg.ID,
			Name:             seg.Name,
			Color:            seg.Color,
			WinText:          seg.WinText,
			Weight:           seg.Weight,
			Image:            seg.Image,
			Theme:            theme,
			SortOrder:        seg.SortOrder,
			MaxCount:         seg.MaxCount,
			Unlimited:        unlimitedInt,
			DepletedBehavior: depletedBehavior,
			IsRespin:         isRespinInt,
			ImageOffsetX:     seg.ImageOffsetX,
			ImageOffsetY:     seg.ImageOffsetY,
			ImageRotation:    seg.ImageRotation,
			ImageScale:       imageScale,
			UsedCount:        usedCount,
			Remaining:        remainingPtr,
		})
	}

	// ── distribution[] ──────────────────────────────────────────────────────────
	// Port: SELECT segment_name, COUNT(*) as count
	//       FROM spins WHERE campaign_id = ? GROUP BY segment_name ORDER BY count DESC
	var distribution []distributionRow
	if err := s.DB.Raw(`
		SELECT segment_name, COUNT(*) AS count
		FROM spins
		WHERE campaign_id = ?
		GROUP BY segment_name
		ORDER BY count DESC
	`, campaignID).Scan(&distribution).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (distribution)")
		return
	}
	if distribution == nil {
		distribution = []distributionRow{}
	}

	// ── recent_spins[] ───────────────────────────────────────────────────────────
	// Port: SELECT s.segment_name, s.win_text, s.created_at, seg.color
	//       FROM spins s
	//       LEFT JOIN segments seg ON s.segment_id = seg.id AND seg.campaign_id = ?
	//       WHERE s.campaign_id = ?
	//       ORDER BY s.created_at DESC
	//
	// PHP-Join: seg.customer_id = ? (zweite Bedingung); in Go: seg.campaign_id = ?
	var recentSpins []recentSpinRow
	if err := s.DB.Raw(`
		SELECT s.segment_name, s.win_text, s.created_at, COALESCE(seg.color, '') AS color
		FROM spins s
		LEFT JOIN segments seg ON s.segment_id = seg.id AND seg.campaign_id = ?
		WHERE s.campaign_id = ?
		ORDER BY s.created_at DESC
	`, campaignID, campaignID).Scan(&recentSpins).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (recent spins)")
		return
	}
	if recentSpins == nil {
		recentSpins = []recentSpinRow{}
	}

	// ── lead_stats ───────────────────────────────────────────────────────────────
	// Port:
	//   SELECT COUNT(*) as lead_count FROM leads WHERE campaign_id = ?
	//   SELECT COUNT(*) as spin_count FROM spins WHERE campaign_id = ?
	//   SELECT COUNT(*) as with_lead  FROM spins WHERE campaign_id = ? AND lead_id IS NOT NULL
	var leadCount int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM leads WHERE campaign_id = ?`,
		campaignID,
	).Scan(&leadCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (lead count)")
		return
	}

	var spinCount int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM spins WHERE campaign_id = ?`,
		campaignID,
	).Scan(&spinCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (spin count)")
		return
	}

	var spinsWithLead int
	if err := s.DB.Raw(
		`SELECT COUNT(*) FROM spins WHERE campaign_id = ? AND lead_id IS NOT NULL`,
		campaignID,
	).Scan(&spinsWithLead).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (spins with lead)")
		return
	}

	conversionRate := 0.0
	if spinCount > 0 {
		conversionRate = math.Round((float64(spinsWithLead)/float64(spinCount))*1000) / 10
	}

	// top_lead_prizes: Port:
	//   SELECT s.segment_name, COUNT(*) as count
	//   FROM spins s
	//   WHERE s.campaign_id = ? AND s.lead_id IS NOT NULL
	//   GROUP BY s.segment_name
	//   ORDER BY count DESC LIMIT 5
	var topLeadPrizes []topLeadPrizeRow
	if err := s.DB.Raw(`
		SELECT segment_name, COUNT(*) AS count
		FROM spins
		WHERE campaign_id = ? AND lead_id IS NOT NULL
		GROUP BY segment_name
		ORDER BY count DESC
		LIMIT 5
	`, campaignID).Scan(&topLeadPrizes).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Datenbankfehler (top lead prizes)")
		return
	}
	if topLeadPrizes == nil {
		topLeadPrizes = []topLeadPrizeRow{}
	}

	writeJSON(w, http.StatusOK, statsResponse{
		TotalSpins:        usedPool,
		TotalSpinsLimit:   totalPool,
		RemainingSpins:    remaining,
		CampaignStatus:    campaignStatus,
		CampaignStartedAt: campaign.StartedAt,
		ProgressPercent:   progressPercent,
		ActiveSegments:    activeSegmentsCount,
		SegmentStats:      segmentStats,
		Distribution:      distribution,
		RecentSpins:       recentSpins,
		LeadStats: leadStats{
			LeadCount:        leadCount,
			SpinCount:        spinCount,
			SpinsWithLead:    spinsWithLead,
			SpinsWithoutLead: spinCount - spinsWithLead,
			ConversionRate:   conversionRate,
			TopLeadPrizes:    topLeadPrizes,
		},
	})
}
