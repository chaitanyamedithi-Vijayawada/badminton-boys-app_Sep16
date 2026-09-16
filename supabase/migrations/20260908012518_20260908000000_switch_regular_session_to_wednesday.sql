/*
# Switch regular midweek sessions from Tuesday to Wednesday

1. Data changes
- Converts existing `tuesday` values to `wednesday` in RSVP, guest, attendance, and completed-session records.
- Renames the midweek settings keys to `courts_wednesday`, `cancelled_wednesday`, and `wed_time`.

2. Constraint changes
- Updates the day checks on RSVP, guest, attendance, and completed-session records to accept `saturday` and `wednesday`.

3. Important notes
- Saturday records and all financial amounts are preserved.
- Existing historical session dates are not changed; only their regular-session day label is updated.
*/

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_day_check;
ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_day_check;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_day_check;
ALTER TABLE completed_sessions DROP CONSTRAINT IF EXISTS completed_sessions_day_check;

UPDATE rsvps SET day = 'wednesday' WHERE day = 'tuesday';
UPDATE guests SET day = 'wednesday' WHERE day = 'tuesday';
UPDATE attendance SET day = 'wednesday' WHERE day = 'tuesday';
UPDATE completed_sessions SET day = 'wednesday' WHERE day = 'tuesday';

ALTER TABLE rsvps ADD CONSTRAINT rsvps_day_check CHECK (day IN ('saturday', 'wednesday'));
ALTER TABLE guests ADD CONSTRAINT guests_day_check CHECK (day IN ('saturday', 'wednesday'));
ALTER TABLE attendance ADD CONSTRAINT attendance_day_check CHECK (day IN ('saturday', 'wednesday'));
ALTER TABLE completed_sessions ADD CONSTRAINT completed_sessions_day_check CHECK (day IN ('saturday', 'wednesday'));

UPDATE settings SET key = 'courts_wednesday' WHERE key = 'courts_tuesday';
UPDATE settings SET key = 'cancelled_wednesday' WHERE key = 'cancelled_tuesday';
UPDATE settings SET key = 'wed_time' WHERE key = 'tue_time';
