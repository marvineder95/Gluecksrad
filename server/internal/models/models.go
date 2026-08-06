package models

import (
	"time"

	"gorm.io/datatypes"
)

// ─── Global / per-Kunde ───────────────────────────────────────────────────────

type Customer struct {
	ID            uint64    `gorm:"primaryKey"          json:"id"`
	CompanyName   string    `gorm:"not null"            json:"company_name"`
	ContactName   string    `                           json:"contact_name"`
	Email         string    `gorm:"not null"            json:"email"`
	Logo          string    `                           json:"logo"`
	IsActive      bool      `gorm:"default:true"        json:"is_active"`
	Subdomain     string    `gorm:"uniqueIndex"         json:"subdomain"`
	ExportEnabled bool      `gorm:"default:false"       json:"export_enabled"`
	CampaignLimit int       `gorm:"default:1"           json:"campaign_limit"` // bezahlte Kontrolle
	CreatedAt     time.Time `                           json:"created_at"`
}

type User struct {
	ID              uint64     `gorm:"primaryKey"                      json:"id"`
	Email           string     `gorm:"uniqueIndex;not null"            json:"email"`
	Username        string     `                                       json:"username"`
	PasswordHash    string     `gorm:"not null"                        json:"-"`
	Role            string     `gorm:"not null;default:customer_admin" json:"role"` // super_admin|customer_admin
	CustomerID      *uint64    `                                       json:"customer_id"`
	APIToken        *string    `gorm:"uniqueIndex;column:api_token"    json:"-"`
	APITokenExpires *time.Time `gorm:"column:api_token_expires_at"     json:"-"`
	LastLoginAt     *time.Time `                                       json:"last_login_at"`
	IsActive        bool       `gorm:"default:true"                    json:"is_active"`
	CreatedAt       time.Time  `                                       json:"created_at"`
}

// ─── Per-Kampagne ─────────────────────────────────────────────────────────────

// Campaign ist der Hauptscope für alle Betriebsdaten.
// status: draft|running|paused|ended|archived
// on_empty: end|default
type Campaign struct {
	ID               uint64     `gorm:"primaryKey"          json:"id"`
	CustomerID       uint64     `gorm:"index;not null"      json:"customer_id"`
	Name             string     `gorm:"not null"            json:"name"`
	Status           string     `gorm:"not null;default:draft" json:"status"`
	OnEmpty          string     `gorm:"not null;default:end"   json:"on_empty"`
	DefaultSegmentID *uint64    `                           json:"default_segment_id"`
	EstimatedSpins   int        `gorm:"default:100"         json:"estimated_spins"`
	CreatedAt        time.Time  `                           json:"created_at"`
	StartedAt        *time.Time `                           json:"started_at"`
	EndedAt          *time.Time `                           json:"ended_at"`
}

// Segment beschreibt ein Feld auf dem Glücksrad, scoped per campaign_id.
// depleted_behavior: hide|grey|normal
type Segment struct {
	ID               uint64    `gorm:"primaryKey"                 json:"id"`
	CampaignID       uint64    `gorm:"index;not null"             json:"campaign_id"`
	Name             string    `gorm:"not null"                   json:"name"`
	Color            string    `gorm:"not null;default:#FF6B35"   json:"color"`
	WinText          string    `                                  json:"win_text"`
	Weight           int       `gorm:"not null;default:100"       json:"weight"`
	Image            string    `                                  json:"image"`
	Theme            string    `gorm:"not null;default:neutral"   json:"theme"`
	SortOrder        int       `gorm:"default:0"                  json:"sort_order"`
	MaxCount         int       `gorm:"default:0"                  json:"max_count"`
	Unlimited        bool      `gorm:"default:false"              json:"unlimited"`
	DepletedBehavior string    `gorm:"not null;default:hide"      json:"depleted_behavior"`
	IsRespin         bool      `gorm:"default:false"              json:"is_respin"`
	ImageOffsetX     float64   `gorm:"default:0"                  json:"image_offset_x"`
	ImageOffsetY     float64   `gorm:"default:0"                  json:"image_offset_y"`
	ImageRotation    float64   `gorm:"default:0"                  json:"image_rotation"`
	ImageScale       float64   `gorm:"default:1"                  json:"image_scale"`
	IsActive         bool      `gorm:"default:true"               json:"is_active"`
	CreatedAt        time.Time `                                  json:"created_at"`
	UpdatedAt        time.Time `                                  json:"updated_at"`
}

// Setting ist ein Key-Value-Paar pro Kampagne (design-tokens, kampagnen-parameter).
// DB-unique constraint: (campaign_id, key).
type Setting struct {
	ID         uint64    `gorm:"primaryKey"          json:"id"`
	CampaignID uint64    `gorm:"index;not null"      json:"campaign_id"`
	Key        string    `gorm:"not null;column:key" json:"key"`
	Value      string    `gorm:"column:value"        json:"value"`
	UpdatedAt  time.Time `                           json:"updated_at"`
}

// Spin protokolliert jeden Dreh des Rades.
type Spin struct {
	ID          uint64    `gorm:"primaryKey"     json:"id"`
	CampaignID  uint64    `gorm:"index;not null" json:"campaign_id"`
	SegmentID   uint64    `gorm:"not null"       json:"segment_id"`
	SegmentName string    `gorm:"not null"       json:"segment_name"`
	WinText     string    `                      json:"win_text"`
	LeadID      *uint64   `                      json:"lead_id"`
	CreatedAt   time.Time `                      json:"created_at"`
}

// SpinPool enthält die vorgenerierte Preis-Sequenz für eine Kampagne.
type SpinPool struct {
	ID            uint64     `gorm:"primaryKey"     json:"id"`
	CampaignID    uint64     `gorm:"index;not null" json:"campaign_id"`
	SegmentID     uint64     `gorm:"not null"       json:"segment_id"`
	SequenceOrder int        `gorm:"not null"       json:"sequence_order"`
	IsUsed        bool       `gorm:"default:false"  json:"is_used"`
	UsedAt        *time.Time `                      json:"used_at"`
	SpinID        *uint64    `                      json:"spin_id"`
}

// TableName erzwingt den Tabellennamen (gorm würde sonst zu "spin_pools"
// pluralisieren; die Migration heißt "spin_pool").
func (SpinPool) TableName() string { return "spin_pool" }

// Lead erfasst Kontaktdaten eines Teilnehmers.
// Data enthält optionale Zusatzfelder als JSONB (datatypes.JSON → Postgres jsonb).
type Lead struct {
	ID           uint64         `gorm:"primaryKey"     json:"id"`
	CampaignID   uint64         `gorm:"index;not null" json:"campaign_id"`
	Name         string         `gorm:"not null"       json:"name"`
	Email        string         `gorm:"not null"       json:"email"`
	SpinID       *uint64        `                      json:"spin_id"`
	Prize        string         `                      json:"prize"`
	ConsentGiven bool           `gorm:"default:false"  json:"consent_given"`
	Data         datatypes.JSON `gorm:"type:jsonb"     json:"data"`
	CreatedAt    time.Time      `                      json:"created_at"`
}
