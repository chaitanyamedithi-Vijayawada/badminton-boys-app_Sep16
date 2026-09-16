/*
  # Add email column to players table

  1. Changes
    - Adds `email` column (text, nullable) to `players` table
    - Players can optionally provide their email address for session notifications

  2. Notes
    - No RLS changes needed — email column follows same policies as the players table
    - Email is optional; players without an email simply won't receive email notifications
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'email'
  ) THEN
    ALTER TABLE players ADD COLUMN email text DEFAULT NULL;
  END IF;
END $$;
