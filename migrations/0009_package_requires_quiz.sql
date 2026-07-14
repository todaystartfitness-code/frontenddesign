-- Lets the assessment quiz be skipped per package (e.g. Thai Bodywork
-- doesn't need it, personal training offers do).
ALTER TABLE packages ADD COLUMN requires_quiz INTEGER NOT NULL DEFAULT 1;
