-- Phase 3: Stripe payments — package purchases and $125 drop-in sessions.

-- One row per Stripe Checkout attempt. Credits/bookings are granted by the
-- webhook when Stripe confirms payment, keyed by checkout session id.
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  package_id INTEGER NOT NULL REFERENCES packages(id),
  kind TEXT NOT NULL CHECK (kind IN ('package', 'drop_in')),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  ledger_id INTEGER REFERENCES credit_ledger(id),
  session_id INTEGER REFERENCES sessions(id),
  -- Drop-in bookings: the slot being paid for.
  slot_starts_at INTEGER,
  slot_duration_minutes INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX idx_purchases_client ON purchases(client_id);
CREATE INDEX idx_purchases_status ON purchases(status);

-- Holds a slot while a drop-in payment is in Stripe Checkout, so nobody else
-- can book it out from under the paying client. Expired holds just lapse.
CREATE TABLE slot_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  purchase_id INTEGER REFERENCES purchases(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_slot_holds_expires ON slot_holds(expires_at);
