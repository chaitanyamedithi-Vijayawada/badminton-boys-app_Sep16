/*
  # Create completed_sessions table

  Stores full session records for both Saturday and Tuesday sessions.
  When a session ends (cutoff passes), it is automatically saved here
  along with all player data and costs. Wallet deductions happen automatically.

  1. New Tables
    - `completed_sessions`
      - `id` (bigserial, primary key)
      - `week` (text) - week key e.g. "2026-W15"
      - `day` (text) - "saturday" or "tuesday"
      - `session_date` (date) - actual date of the session
      - `players` (jsonb) - array of player names who attended
      - `guests` (jsonb) - array of guest entries
      - `courts` (jsonb) - array of court numbers booked
      - `courts_count` (integer) - number of courts
      - `rate_per_court` (numeric(10,2)) - rate at time of session
      - `total_cost` (numeric(10,2)) - total court cost
      - `players_count` (integer) - total people (players + guests)
      - `per_person` (numeric(10,2)) - per-person cost
      - `auto_deducted` (boolean, default true) - whether wallets were auto-deducted
      - `created_at` (timestamptz)
      - UNIQUE(week, day) - one record per session

  2. Security
    - Enable RLS on `completed_sessions` table
    - Allow read/insert/update for anon users (app uses anon key)
*/

CREATE TABLE IF NOT EXISTS completed_sessions (
  id bigserial PRIMARY KEY,
  week text NOT NULL,
  day text NOT NULL CHECK (day IN ('saturday', 'tuesday')),
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  players jsonb NOT NULL DEFAULT '[]'::jsonb,
  guests jsonb NOT NULL DEFAULT '[]'::jsonb,
  courts jsonb NOT NULL DEFAULT '[]'::jsonb,
  courts_count integer NOT NULL DEFAULT 0,
  rate_per_court numeric(10,2) NOT NULL DEFAULT 0,
  total_cost numeric(10,2) NOT NULL DEFAULT 0,
  players_count integer NOT NULL DEFAULT 0,
  per_person numeric(10,2) NOT NULL DEFAULT 0,
  auto_deducted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(week, day)
);

ALTER TABLE completed_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access for anon"
  ON completed_sessions
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow insert for anon"
  ON completed_sessions
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow update for anon"
  ON completed_sessions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
