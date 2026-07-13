-- Phase 2: business hours, admin-editable settings, and actual training sessions.

-- Session duration is fixed per package (decided in Phase 1 planning) but the
-- column was never added since Phase 1 had no actual bookings yet. Default
-- existing packages to 60 (the spec's "up to 60 minutes" baseline).
ALTER TABLE packages ADD COLUMN session_duration_minutes INTEGER NOT NULL DEFAULT 60;

CREATE TABLE business_hours (
  day_of_week INTEGER PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  is_closed INTEGER NOT NULL DEFAULT 0,
  open_minute INTEGER,  -- minutes since midnight, America/Phoenix. NULL if closed.
  close_minute INTEGER
);

-- Date-specific overrides (holidays, one-off closures or special hours).
-- A row here always wins over the weekly business_hours for that date.
CREATE TABLE business_hours_overrides (
  date TEXT PRIMARY KEY, -- YYYY-MM-DD, America/Phoenix
  is_closed INTEGER NOT NULL DEFAULT 0,
  open_minute INTEGER,
  close_minute INTEGER,
  note TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Actual training sessions (distinct from login_sessions, the auth table).
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  ledger_id INTEGER REFERENCES credit_ledger(id),
  starts_at INTEGER NOT NULL, -- unix seconds
  ends_at INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed')),
  created_by TEXT NOT NULL CHECK (created_by IN ('client', 'admin')),
  credit_restored INTEGER NOT NULL DEFAULT 0,
  cancelled_at INTEGER,
  cancelled_reason TEXT,
  google_event_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_sessions_client ON sessions(client_id);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at);
CREATE INDEX idx_sessions_status ON sessions(status);
