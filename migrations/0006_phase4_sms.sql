-- Phase 4: SMS notifications, 90-min reminders, and phone-based login.

-- Tracks whether the 90-minute-before reminder has been sent for a session,
-- so the cron job never double-sends.
ALTER TABLE sessions ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0;

-- Which channel a magic link was issued for ('email' or 'phone'). The
-- existing `email` column stores the actual identifier value for either
-- channel (an email address or an E.164 phone number) to avoid a redundant
-- column — `channel` just tells verification how to interpret it.
ALTER TABLE magic_link_tokens ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';

CREATE INDEX idx_sessions_reminder ON sessions(reminder_sent, starts_at);
