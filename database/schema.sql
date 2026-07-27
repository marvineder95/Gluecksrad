-- Point4 Spin – Multi-Tenant SQLite Datenbankschema

-- Kunden-Tabelle
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT NOT NULL,
    logo TEXT,
    is_active INTEGER DEFAULT 1,
    subdomain TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Benutzer-Tabelle
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer_admin',
    customer_id INTEGER REFERENCES customers(id),
    api_token TEXT,
    api_token_expires_at DATETIME,
    last_login_at DATETIME,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Standard-Super-Admin (Passwort MUSS nach Setup geändert werden)
INSERT OR IGNORE INTO users (id, email, username, password_hash, role, customer_id) VALUES 
(1, 'admin@point4studio.at', 'admin', '$2y$12$7NlW0YM5WgcSHWcMC7HPT.Hr1ntyw.M2OH4V797roL9.cv98.8jey', 'super_admin', NULL);

-- Segmente-Tabelle
CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#FF6B35',
    win_text TEXT,
    weight INTEGER NOT NULL DEFAULT 100,
    image TEXT,
    sort_order INTEGER DEFAULT 0,
    max_count INTEGER DEFAULT 0,
    image_offset_x REAL DEFAULT 0,
    image_offset_y REAL DEFAULT 0,
    image_rotation REAL DEFAULT 0,
    image_scale REAL DEFAULT 1,
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

-- Einstellungen-Tabelle (pro Kunde)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, setting_key)
);

-- Spins-Tabelle (Statistik, pro Kunde)
CREATE TABLE IF NOT EXISTS spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    segment_id INTEGER NOT NULL,
    segment_name TEXT NOT NULL,
    win_text TEXT,
    lead_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spin Pool (pro Kunde)
CREATE TABLE IF NOT EXISTS spin_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    segment_id INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    spin_id INTEGER,
    FOREIGN KEY (segment_id) REFERENCES segments(id)
);

-- Kampagnen-Archive (pro Kunde)
CREATE TABLE IF NOT EXISTS campaign_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    spin_count INTEGER NOT NULL DEFAULT 0,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rate-Limiting für Login (global)
CREATE TABLE IF NOT EXISTS rate_limits (
    identifier TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    first_attempt INTEGER,
    last_attempt INTEGER
);

-- Leads-Tabelle (für Lead-Capture vor dem Drehen)
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    spin_id INTEGER,
    prize TEXT,
    consent_given INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- Lead-Verknüpfung zu Spins
ALTER TABLE spins ADD COLUMN lead_id INTEGER;

-- Performance-Indizes
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
CREATE INDEX IF NOT EXISTS idx_users_customer ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_segments_customer ON segments(customer_id);
CREATE INDEX IF NOT EXISTS idx_segments_is_active ON segments(is_active);
CREATE INDEX IF NOT EXISTS idx_settings_customer_key ON settings(customer_id, setting_key);
CREATE INDEX IF NOT EXISTS idx_spins_customer ON spins(customer_id);
CREATE INDEX IF NOT EXISTS idx_spins_segment_id ON spins(segment_id);
CREATE INDEX IF NOT EXISTS idx_spins_created_at ON spins(created_at);
CREATE INDEX IF NOT EXISTS idx_spins_lead_id ON spins(lead_id);
CREATE INDEX IF NOT EXISTS idx_spin_pool_customer ON spin_pool(customer_id);
CREATE INDEX IF NOT EXISTS idx_spin_pool_order ON spin_pool(sequence_order);
CREATE INDEX IF NOT EXISTS idx_spin_pool_used ON spin_pool(is_used);
CREATE INDEX IF NOT EXISTS idx_campaign_archives_customer ON campaign_archives(customer_id);
