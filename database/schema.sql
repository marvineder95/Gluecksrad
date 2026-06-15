-- Event-Glücksrad SQLite Datenbankschema

-- Benutzer-Tabelle
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    api_token TEXT,
    api_token_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Standard-Admin (Passwort MUSS nach Setup über Admin-Panel geändert werden)
INSERT OR IGNORE INTO users (id, username, password_hash) VALUES 
(1, 'Glücksrad', '$2y$12$7NlW0YM5WgcSHWcMC7HPT.Hr1ntyw.M2OH4V797roL9.cv98.8jey');

-- Segmente-Tabelle
CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#FF6B35',
    win_text TEXT,
    weight INTEGER NOT NULL DEFAULT 100,
    image TEXT,
    sort_order INTEGER DEFAULT 0,
    max_count INTEGER DEFAULT 0,
    theme TEXT DEFAULT 'neutral',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Auto-Update Trigger für segments.updated_at
CREATE TRIGGER IF NOT EXISTS segments_updated_at 
    AFTER UPDATE ON segments
    BEGIN
        UPDATE segments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Einstellungen-Tabelle
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Standard-Einstellungen
INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES
('primary_color', '#1E3A8A'),
('secondary_color', '#F6A7C4'),
('accent_color', '#D4AF37'),
('font_family', 'Montserrat'),
('wheel_title', 'Glücksrad'),
('total_spins_limit', '1000'),
('campaign_status', 'running'),
('theme', 'dove'),
('auto_remove_bg', '0');

-- Spins-Tabelle (Statistik)
CREATE TABLE IF NOT EXISTS spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL,
    segment_name TEXT NOT NULL,
    win_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spin Pool (deterministische Verteilung)
CREATE TABLE IF NOT EXISTS spin_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    spin_id INTEGER,
    FOREIGN KEY (segment_id) REFERENCES segments(id)
);
CREATE INDEX IF NOT EXISTS idx_spin_pool_order ON spin_pool(sequence_order);
CREATE INDEX IF NOT EXISTS idx_spin_pool_used ON spin_pool(is_used);

-- Kampagnen-Archive
CREATE TABLE IF NOT EXISTS campaign_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spin_count INTEGER NOT NULL DEFAULT 0,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rate-Limiting für Login
CREATE TABLE IF NOT EXISTS rate_limits (
    identifier TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    first_attempt INTEGER,
    last_attempt INTEGER
);

-- Performance-Indizes
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
CREATE INDEX IF NOT EXISTS idx_spins_segment_id ON spins(segment_id);
CREATE INDEX IF NOT EXISTS idx_spins_created_at ON spins(created_at);
CREATE INDEX IF NOT EXISTS idx_segments_is_active ON segments(is_active);
