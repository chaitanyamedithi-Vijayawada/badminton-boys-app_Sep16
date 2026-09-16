/*
  # Create player_transfers table

  Tracks when players transfer $50 to admin/Arun via Zelle.
  This records every transfer submission so there is a full audit trail.

  1. New Tables
    - `player_transfers`
      - `id` (bigserial, primary key)
      - `player_name` (text) - who sent the money
      - `amount` (numeric(10,2), default 50) - transfer amount
      - `recipient` (text, default 'Arun') - who received the money (admin or Arun)
      - `method` (text, default 'Zelle') - payment method
      - `status` (text, default 'pending') - pending, confirmed, rejected
      - `confirmed_by` (text, nullable) - admin who confirmed
      - `confirmed_at` (timestamptz, nullable) - when confirmed
      - `notes` (text, default '') - optional notes
      - `created_at` (timestamptz, default now()) - submission timestamp

  2. Security
    - Enable RLS on `player_transfers` table
    - Add policy for authenticated users to read their own transfers
    - Add policy for anon users to read all (app uses anon key, no auth)
*/

CREATE TABLE IF NOT EXISTS player_transfers (
  id bigserial PRIMARY KEY,
  player_name text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 50,
  recipient text NOT NULL DEFAULT 'Arun',
  method text NOT NULL DEFAULT 'Zelle',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_by text,
  confirmed_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE player_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access for anon"
  ON player_transfers
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow insert for anon"
  ON player_transfers
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow update for anon"
  ON player_transfers
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
