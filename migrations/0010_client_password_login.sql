-- Client password login (in addition to magic-link login), plus two new
-- reminder tiers (24h and 2h before a session) replacing the old 90-minute
-- one. The old sessions.reminder_sent column is no longer read by the app
-- after this migration — left in place rather than dropped to keep this a
-- pure-addition migration.
ALTER TABLE clients ADD COLUMN password_hash TEXT;
ALTER TABLE sessions ADD COLUMN reminder_24h_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN reminder_2h_sent INTEGER NOT NULL DEFAULT 0;
