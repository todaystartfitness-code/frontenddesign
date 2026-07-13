-- Weekly business hours (America/Phoenix, no DST). Minutes since midnight.
INSERT INTO business_hours (day_of_week, is_closed, open_minute, close_minute) VALUES
  (0, 1, NULL, NULL),  -- Sunday: closed
  (1, 0, 480, 1215),   -- Monday: 8:00am - 8:15pm
  (2, 0, 480, 1215),   -- Tuesday: 8:00am - 8:15pm
  (3, 0, 480, 1215),   -- Wednesday: 8:00am - 8:15pm
  (4, 0, 480, 1215),   -- Thursday: 8:00am - 8:15pm
  (5, 0, 480, 990),    -- Friday: 8:00am - 4:30pm
  (6, 0, 540, 930);    -- Saturday: 9:00am - 3:30pm

INSERT INTO settings (key, value) VALUES
  ('buffer_before_minutes', '15'),
  ('buffer_after_minutes', '30'),
  ('reschedule_window_hours', '24');
