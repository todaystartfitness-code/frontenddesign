-- Phase 1: clients/auth, packages, and credit ledger.

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE magic_link_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('app', 'admin')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_magic_link_tokens_email ON magic_link_tokens(email);

-- Login sessions (browser cookie sessions), distinct from training sessions.
CREATE TABLE login_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_login_sessions_client ON login_sessions(client_id);

CREATE TABLE packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  session_count INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  expiration_days INTEGER NOT NULL,
  is_drop_in INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One row per grant of credits (a purchase or a manual admin adjustment).
-- Bookings deduct from whichever row has the soonest expires_at.
CREATE TABLE credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  package_id INTEGER NOT NULL REFERENCES packages(id),
  source TEXT NOT NULL CHECK (source IN ('purchase', 'manual_admin')),
  sessions_granted INTEGER NOT NULL,
  sessions_remaining INTEGER NOT NULL,
  granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  note TEXT
);

CREATE INDEX idx_credit_ledger_client ON credit_ledger(client_id);
CREATE INDEX idx_credit_ledger_expires ON credit_ledger(expires_at);

-- Audit trail of every grant/deduct/restore against a ledger row.
CREATE TABLE credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES credit_ledger(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
