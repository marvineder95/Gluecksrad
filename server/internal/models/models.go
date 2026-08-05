package models

import "time"

// Kern-Modelle (Phase 0). Weitere Tabellen (segments, settings, spins,
// spin_pool, leads, kiosk_sessions, notifications) folgen in Phase 1/2.

type Customer struct {
	ID            uint64    `gorm:"primaryKey" json:"id"`
	CompanyName   string    `gorm:"not null" json:"company_name"`
	ContactName   string    `json:"contact_name"`
	Email         string    `gorm:"not null" json:"email"`
	Logo          string    `json:"logo"`
	IsActive      bool      `gorm:"default:true" json:"is_active"`
	Subdomain     string    `gorm:"uniqueIndex" json:"subdomain"`
	ExportEnabled bool      `gorm:"default:false" json:"export_enabled"`
	CampaignLimit int       `gorm:"default:1" json:"campaign_limit"` // bezahlte Kontrolle: max. Anzahl Kampagnen
	CreatedAt     time.Time `json:"created_at"`
}

type User struct {
	ID              uint64     `gorm:"primaryKey" json:"id"`
	Email           string     `gorm:"uniqueIndex;not null" json:"email"`
	Username        string     `json:"username"`
	PasswordHash    string     `gorm:"not null" json:"-"`
	Role            string     `gorm:"not null;default:customer_admin" json:"role"` // super_admin | customer_admin
	CustomerID      *uint64    `json:"customer_id"`
	APIToken        *string    `gorm:"uniqueIndex" json:"-"`
	APITokenExpires *time.Time `json:"-"`
	LastLoginAt     *time.Time `json:"last_login_at"`
	IsActive        bool       `gorm:"default:true" json:"is_active"`
	CreatedAt       time.Time  `json:"created_at"`
}

// Campaign: zentrale Scope-Ebene unter dem Kunden (Task 4).
type Campaign struct {
	ID               uint64     `gorm:"primaryKey" json:"id"`
	CustomerID       uint64     `gorm:"index;not null" json:"customer_id"`
	Name             string     `gorm:"not null" json:"name"`
	Status           string     `gorm:"not null;default:draft" json:"status"` // draft|running|paused|ended|archived
	OnEmpty          string     `gorm:"not null;default:end" json:"on_empty"` // end|default
	DefaultSegmentID *uint64    `json:"default_segment_id"`
	EstimatedSpins   int        `gorm:"default:100" json:"estimated_spins"`
	CreatedAt        time.Time  `json:"created_at"`
	StartedAt        *time.Time `json:"started_at"`
	EndedAt          *time.Time `json:"ended_at"`
}
