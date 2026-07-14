-- Phase 6: public booking widget (Lunacal replacement) + assessment quiz.

-- Packages must be explicitly flagged to appear in the public widget, and
-- can optionally skip payment (e.g. a free consultation).
ALTER TABLE packages ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN requires_payment INTEGER NOT NULL DEFAULT 1;

-- A single lead-qualification quiz shown before the package picker in the
-- public booking flow. No scoring — answers are just saved for the admin to
-- review alongside the booking.
CREATE TABLE quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position INTEGER NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'short_text', 'scale_1_10')),
  prompt TEXT NOT NULL,
  options TEXT, -- JSON array of option strings; only used for multiple_choice
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE quiz_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  question_id INTEGER NOT NULL REFERENCES quiz_questions(id),
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_quiz_responses_client ON quiz_responses(client_id);
