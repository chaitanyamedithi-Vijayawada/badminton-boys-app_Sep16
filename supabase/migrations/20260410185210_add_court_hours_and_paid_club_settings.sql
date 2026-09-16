/*
  # Add persistent court hours and paid-to-club tracking

  1. New Settings
    - `total_court_hours` - Running total of court hours purchased/used
    - `total_paid_club` - Running total of all court payments made to the club

  2. Data Migration
    - Initialize total_court_hours from existing fund entries (manual: parsed from notes, auto: derived from amount / hourly rate)
    - Initialize total_paid_club from sum of all court payment fund entries

  3. Notes
    - These are cumulative values that get incremented with each new court payment
    - This fixes the bug where court hours only counted manual entries and ignored auto-deductions
*/

DO $$
DECLARE
  v_manual_hours numeric := 0;
  v_auto_hours numeric := 0;
  v_total_paid numeric := 0;
  v_hourly_rate numeric;
  r record;
BEGIN
  SELECT COALESCE(value::numeric, 22.70) INTO v_hourly_rate
  FROM settings WHERE key = 'court_rate';

  IF v_hourly_rate IS NULL THEN
    v_hourly_rate := 22.70;
  END IF;

  FOR r IN
    SELECT amount, notes FROM fund_entries
    WHERE notes ILIKE '%court payment%' AND amount < 0
  LOOP
    v_total_paid := v_total_paid + ABS(r.amount);

    IF r.notes ~ 'Court payment:\s*[\d.]+\s*hrs?' THEN
      v_manual_hours := v_manual_hours + (regexp_replace(r.notes, '.*Court payment:\s*([\d.]+)\s*hrs?.*', '\1'))::numeric;
    ELSE
      v_auto_hours := v_auto_hours + (ABS(r.amount) / v_hourly_rate);
    END IF;
  END LOOP;

  INSERT INTO settings (key, value)
  VALUES ('total_court_hours', (v_manual_hours + v_auto_hours)::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO settings (key, value)
  VALUES ('total_paid_club', v_total_paid::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;
