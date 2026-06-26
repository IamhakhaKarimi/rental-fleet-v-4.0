-- Balkan Car Rentals - v2.0 database schema (SQLite)
-- Money is stored as INTEGER cents everywhere. Dates are ISO-8601 text.
-- This file is executed once on first run; CREATE ... IF NOT EXISTS makes it safe to re-run.

CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id          TEXT PRIMARY KEY,
    make_model          TEXT NOT NULL,
    year                INTEGER,
    license_plate       TEXT,
    color               TEXT,
    mileage             INTEGER DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'Available'
                        CHECK (status IN ('Available','Rented','In Garage','Maintenance','DELETED')),
    base_daily_rate     INTEGER NOT NULL DEFAULT 0 CHECK (base_daily_rate >= 0),  -- cents
    maintenance_charge  INTEGER NOT NULL DEFAULT 0,                                -- cents
    acquisition_cost    INTEGER,
    acquisition_date    TEXT,
    notes               TEXT NOT NULL DEFAULT '',
    photo               TEXT NOT NULL DEFAULT '',   -- base64-encoded JPEG (optional)
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    id_passport   TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rentals (
    deal_id         TEXT PRIMARY KEY,
    customer_id     INTEGER NOT NULL REFERENCES customers(customer_id),
    vehicle_id      TEXT    NOT NULL REFERENCES vehicles(vehicle_id),
    start_dt        TEXT NOT NULL,
    end_dt          TEXT NOT NULL,
    rental_days     INTEGER NOT NULL DEFAULT 0 CHECK (rental_days >= 0),
    daily_rate      INTEGER NOT NULL DEFAULT 0,   -- cents
    total_amount    INTEGER NOT NULL DEFAULT 0,   -- cents
    deposit         INTEGER NOT NULL DEFAULT 0,   -- cents
    status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Closed')),
    contract_signed TEXT NOT NULL DEFAULT 'No',
    return_notes    TEXT NOT NULL DEFAULT '',
    created_by      TEXT NOT NULL DEFAULT '',   -- username of the staff who booked it
    created_by_name TEXT NOT NULL DEFAULT '',   -- their full name (snapshot)
    created_by_role TEXT NOT NULL DEFAULT '',   -- their role id (snapshot)
    invoice_lang    TEXT NOT NULL DEFAULT 'tr', -- language chosen for this rental's invoice
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS charges (
    charge_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id     TEXT REFERENCES rentals(deal_id),
    vehicle_id  TEXT REFERENCES vehicles(vehicle_id),
    type        TEXT NOT NULL CHECK (type IN ('rental','overdue_penalty','damage','deposit','refund')),
    amount      INTEGER NOT NULL,   -- cents
    occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_costs (
    cost_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id  TEXT REFERENCES vehicles(vehicle_id),
    type        TEXT NOT NULL CHECK (type IN ('insurance','maintenance','depreciation','fuel','financing','registration','other')),
    amount      INTEGER NOT NULL,   -- cents
    period_date TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'visitor'
                  CHECK (role IN ('super_admin','admin','employer','visitor')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    lang          TEXT NOT NULL DEFAULT 'tr',   -- the user's preferred UI language
    email         TEXT NOT NULL DEFAULT '',     -- for password-recovery delivery
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,        -- sha256 of the random token kept in the cookie
    username    TEXT NOT NULL,
    expires_at  TEXT NOT NULL,           -- ISO datetime
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT,
    action    TEXT,
    entity    TEXT,
    entity_id TEXT,
    detail    TEXT,
    ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Editable application settings (e.g. the business name set by a super-admin).
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple photos per vehicle (base64 JPEG, all cropped to one standard size).
-- Kept out of the vehicles table so listings stay light; photos are loaded lazily.
CREATE TABLE IF NOT EXISTS vehicle_photos (
    photo_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    photo      TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licenses (
    license_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    licensee      TEXT NOT NULL DEFAULT '',
    year          INTEGER NOT NULL,
    years         INTEGER NOT NULL DEFAULT 1,
    amount        INTEGER NOT NULL DEFAULT 0,
    purchase_date TEXT NOT NULL DEFAULT (date('now')),
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rentals_vehicle  ON rentals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status   ON rentals(status);
CREATE INDEX IF NOT EXISTS idx_rentals_customer ON rentals(customer_id);
CREATE INDEX IF NOT EXISTS idx_rentals_interval ON rentals(vehicle_id, start_dt, end_dt);
CREATE INDEX IF NOT EXISTS idx_charges_deal     ON charges(deal_id);
CREATE INDEX IF NOT EXISTS idx_charges_vehicle  ON charges(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_costs_vehicle    ON vehicle_costs(vehicle_id, period_date);
CREATE INDEX IF NOT EXISTS idx_vphotos_vehicle  ON vehicle_photos(vehicle_id, position, photo_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
