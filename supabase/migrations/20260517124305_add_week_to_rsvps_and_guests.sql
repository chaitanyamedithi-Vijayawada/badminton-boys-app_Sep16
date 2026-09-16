/*
  # Add week column to rsvps and guests tables

  ## Summary
  Scopes RSVPs and guest entries to a specific week so votes from previous
  weeks never bleed into a new week. Each week starts completely fresh.

  ## Changes

  ### rsvps table
  - Add `week` column (text, NOT NULL, default to current Saturday-anchored week)
  - Drop old unique constraint on (day, player_name)
  - Add new unique constraint on (week, day, player_name)

  ### guests table
  - Add `week` column (text, NOT NULL, default to current Saturday-anchored week)
  - Drop old unique constraint on (day, brought_by)
  - Add new unique constraint on (week, day, brought_by)

  ## Notes
  - Existing rows get week = '2026-05-17' (the current Saturday)
  - No data is deleted; old rows are simply scoped to last week
*/

-- Add week to rsvps
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS week text NOT NULL DEFAULT '2026-05-17';

-- Drop old unique constraint and add new one
ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_day_player_name_key;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_week_day_player_name_key UNIQUE (week, day, player_name);

-- Add week to guests
ALTER TABLE guests ADD COLUMN IF NOT EXISTS week text NOT NULL DEFAULT '2026-05-17';

-- Drop old unique constraint and add new one
ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_day_brought_by_key;
ALTER TABLE guests ADD CONSTRAINT guests_week_day_brought_by_key UNIQUE (week, day, brought_by);
