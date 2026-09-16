/*
  # Add session deductions tracking table

  1. New Tables
    - `session_deductions`
      - `id` (bigserial, primary key)
      - `week` (text, not null) - the week key e.g. "2026-W15"
      - `day` (text, not null) - "saturday" or "tuesday"
      - `courts_count` (integer, not null) - number of courts booked for this session
      - `rate_per_court` (numeric, not null) - the rate per court at time of deduction
      - `total_cost` (numeric, not null) - total session cost
      - `players_count` (integer, not null) - number of players who attended
      - `per_person` (numeric, not null) - per-person cost deducted
      - `deducted_by` (text, not null) - admin who triggered the deduction
      - `created_at` (timestamptz)
    - Unique constraint on (week, day) to prevent double-deductions

  2. Security
    - Enable RLS on `session_deductions` table
    - Read access for all users
    - Insert access for all users (admin PIN enforced in app)
*/

CREATE TABLE IF NOT EXISTS session_deductions (
  id bigserial PRIMARY KEY,
  week text NOT NULL,
  day text NOT NULL CHECK (day IN ('saturday', 'tuesday')),
  courts_count integer NOT NULL DEFAULT 0,
  rate_per_court numeric(10,2) NOT NULL DEFAULT 0,
  total_cost numeric(10,2) NOT NULL DEFAULT 0,
  players_count integer NOT NULL DEFAULT 0,
  per_person numeric(10,2) NOT NULL DEFAULT 0,
  deducted_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE (week, day)
);

ALTER TABLE session_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read session_deductions"
  ON session_deductions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert session_deductions"
  ON session_deductions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
