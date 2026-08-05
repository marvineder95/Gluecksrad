-- +goose Up
-- +goose StatementBegin

-- Kunden-Tabelle
CREATE TABLE IF NOT EXISTS customers (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_name   TEXT        NOT NULL,
    contact_name   TEXT,
    email          TEXT        NOT NULL,
    logo           TEXT,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    subdomain      TEXT        UNIQUE,
    export_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
    campaign_limit INTEGER     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Benutzer-Tabelle
CREATE TABLE IF NOT EXISTS users (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email                TEXT        NOT NULL UNIQUE,
    username             TEXT,
    password_hash        TEXT        NOT NULL,
    role                 TEXT        NOT NULL DEFAULT 'customer_admin',
    customer_id          BIGINT      REFERENCES customers(id),
    api_token            TEXT        UNIQUE,
    api_token_expires_at TIMESTAMPTZ,
    last_login_at        TIMESTAMPTZ,
    is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
CREATE INDEX IF NOT EXISTS idx_users_customer  ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);

-- Kampagnen-Tabelle (Task 4 scope — jede Kampagne ist unabhängig)
CREATE TABLE IF NOT EXISTS campaigns (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id        BIGINT      NOT NULL REFERENCES customers(id),
    name               TEXT        NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'draft',  -- draft|running|paused|ended|archived
    on_empty           TEXT        NOT NULL DEFAULT 'end',    -- end|default
    default_segment_id BIGINT,                                -- FK ergänzt nach segments-Tabelle
    estimated_spins    INTEGER     NOT NULL DEFAULT 100,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaigns_customer ON campaigns(customer_id);

-- Segmente-Tabelle (campaign_id als Hauptscope)
CREATE TABLE IF NOT EXISTS segments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id      BIGINT      NOT NULL REFERENCES campaigns(id),
    name             TEXT        NOT NULL,
    color            TEXT        NOT NULL DEFAULT '#FF6B35',
    win_text         TEXT,
    weight           INTEGER     NOT NULL DEFAULT 100,
    image            TEXT,
    theme            TEXT        NOT NULL DEFAULT 'neutral',
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    max_count        INTEGER     NOT NULL DEFAULT 0,
    unlimited        BOOLEAN     NOT NULL DEFAULT FALSE,
    depleted_behavior TEXT        NOT NULL DEFAULT 'hide',   -- hide|grey|normal
    is_respin        BOOLEAN     NOT NULL DEFAULT FALSE,
    image_offset_x   DOUBLE PRECISION NOT NULL DEFAULT 0,
    image_offset_y   DOUBLE PRECISION NOT NULL DEFAULT 0,
    image_rotation   DOUBLE PRECISION NOT NULL DEFAULT 0,
    image_scale      DOUBLE PRECISION NOT NULL DEFAULT 1,
    is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_campaign   ON segments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_segments_is_active  ON segments(is_active);

-- FK campaigns → segments (default_segment_id)
ALTER TABLE campaigns
    ADD CONSTRAINT fk_campaigns_default_segment
    FOREIGN KEY (default_segment_id) REFERENCES segments(id)
    DEFERRABLE INITIALLY DEFERRED;

-- Einstellungen-Tabelle (campaign_id als Hauptscope, Schlüssel unique per Kampagne)
CREATE TABLE IF NOT EXISTS settings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
    key         TEXT   NOT NULL,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_campaign_key ON settings(campaign_id, key);

-- Spins-Tabelle (campaign_id als Hauptscope)
CREATE TABLE IF NOT EXISTS spins (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id  BIGINT      NOT NULL REFERENCES campaigns(id),
    segment_id   BIGINT      NOT NULL,
    segment_name TEXT        NOT NULL,
    win_text     TEXT,
    lead_id      BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spins_campaign    ON spins(campaign_id);
CREATE INDEX IF NOT EXISTS idx_spins_segment_id  ON spins(segment_id);
CREATE INDEX IF NOT EXISTS idx_spins_created_at  ON spins(created_at);
CREATE INDEX IF NOT EXISTS idx_spins_lead_id     ON spins(lead_id);

-- Spin-Pool (campaign_id als Hauptscope)
CREATE TABLE IF NOT EXISTS spin_pool (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id    BIGINT      NOT NULL REFERENCES campaigns(id),
    segment_id     BIGINT      NOT NULL REFERENCES segments(id),
    sequence_order INTEGER     NOT NULL,
    is_used        BOOLEAN     NOT NULL DEFAULT FALSE,
    used_at        TIMESTAMPTZ,
    spin_id        BIGINT
);

CREATE INDEX IF NOT EXISTS idx_spin_pool_campaign ON spin_pool(campaign_id);
CREATE INDEX IF NOT EXISTS idx_spin_pool_order    ON spin_pool(sequence_order);
CREATE INDEX IF NOT EXISTS idx_spin_pool_used     ON spin_pool(is_used);

-- Leads-Tabelle (campaign_id als Hauptscope, data als jsonb)
CREATE TABLE IF NOT EXISTS leads (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id   BIGINT      NOT NULL REFERENCES campaigns(id),
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL,
    spin_id       BIGINT,
    prize         TEXT,
    consent_given BOOLEAN     NOT NULL DEFAULT FALSE,
    data          JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_campaign    ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);

-- Rate-Limiting (global, in-memory später ersetzbar)
CREATE TABLE IF NOT EXISTS rate_limits (
    identifier   TEXT PRIMARY KEY,
    attempts     INTEGER,
    first_attempt BIGINT,
    last_attempt  BIGINT
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS fk_campaigns_default_segment;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS spin_pool;
DROP TABLE IF EXISTS spins;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS segments;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS customers;
-- +goose StatementEnd
