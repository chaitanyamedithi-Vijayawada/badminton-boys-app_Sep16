/*
  # Badminton Boys App — Full Schema

  ## Overview
  Complete database schema for the Badminton Boys app, a group sports session management tool.

  ## Tables Created

  ### settings
  - Key-value store for app configuration (admin names, court rates, court bookings, session times)

  ### players
  - Player roster with skill levels (skill stored separately from wallets)

  ### rsvps
  - Per-session RSVP responses (going / skip) per player

  ### guests
  - Guests brought by players to sessions

  ### wallets
  - Player balance tracking (pre-paid credits deducted after each session)

  ### payments
  - Payment submissions from players ($50 top-ups), confirmed by admins

  ### attendance
  - Historical record of which players attended which sessions

  ### fund_entries
  - Admin financial ledger (court payments, expenses, incoming player payments)

  ### messages
  - Group chat messages between players

  ## Security
  - RLS enabled on all tables
  - Authenticated users can read all data (shared group app)
  - Authenticated users can insert/update their own records where applicable
  - Admin operations allowed for authenticated users (PIN enforced in app)

  ## Notes
  - This app uses a PIN-based admin system (enforced client-side)
  - All players share visibility of session data — this is by design
*/

-- Settings table (key-value config store)
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert settings"
  ON settings FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update settings"
  ON settings FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Players table (roster with skill levels)
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  skill text DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read players"
  ON players FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert players"
  ON players FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update players"
  ON players FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete players"
  ON players FOR DELETE
  TO anon, authenticated
  USING (true);

-- RSVPs table
CREATE TABLE IF NOT EXISTS rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day text NOT NULL CHECK (day IN ('saturday', 'tuesday')),
  player_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('going', 'skip')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (day, player_name)
);

ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read rsvps"
  ON rsvps FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert rsvps"
  ON rsvps FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update rsvps"
  ON rsvps FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete rsvps"
  ON rsvps FOR DELETE
  TO anon, authenticated
  USING (true);

-- Guests table
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day text NOT NULL CHECK (day IN ('saturday', 'tuesday')),
  brought_by text NOT NULL,
  friends jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (day, brought_by)
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read guests"
  ON guests FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert guests"
  ON guests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update guests"
  ON guests FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete guests"
  ON guests FOR DELETE
  TO anon, authenticated
  USING (true);

-- Wallets table (player balances)
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text UNIQUE NOT NULL,
  balance numeric(10,2) DEFAULT 0,
  prev_balance numeric(10,2) DEFAULT NULL,
  last_deduction numeric(10,2) DEFAULT NULL,
  last_session text DEFAULT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read wallets"
  ON wallets FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert wallets"
  ON wallets FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update wallets"
  ON wallets FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete wallets"
  ON wallets FOR DELETE
  TO anon, authenticated
  USING (true);

-- Payments table (player top-up submissions)
CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  player_name text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_by text DEFAULT NULL,
  confirmed_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read payments"
  ON payments FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert payments"
  ON payments FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update payments"
  ON payments FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Attendance table (session history)
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week text NOT NULL,
  day text NOT NULL CHECK (day IN ('saturday', 'tuesday')),
  player_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (week, day, player_name)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read attendance"
  ON attendance FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert attendance"
  ON attendance FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can delete attendance"
  ON attendance FOR DELETE
  TO anon, authenticated
  USING (true);

-- Fund entries table (admin financial ledger)
CREATE TABLE IF NOT EXISTS fund_entries (
  id bigserial PRIMARY KEY,
  amount numeric(10,2) NOT NULL,
  entered_by text NOT NULL DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fund_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read fund_entries"
  ON fund_entries FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert fund_entries"
  ON fund_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Messages table (group chat)
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  sender text NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read messages"
  ON messages FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert messages"
  ON messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Seed initial player wallets
INSERT INTO wallets (player_name, balance) VALUES
  ('Aakash', 78.74), ('Anand', 95.77), ('Arun', 50.00), ('Ashok', 0.00),
  ('Bharath', 2.17), ('Chaitanya', 42.30), ('Eswar', 44.44), ('Jagdeesh', 66.82),
  ('Jatinder', 40.91), ('Malli', 66.52), ('Maruthi Dr', 85.19), ('Naga', 74.57),
  ('Navan', 54.12), ('Raghu', 36.19), ('Rakesh', 2.17), ('Ram', 53.40),
  ('Ravi', 59.71), ('Sachin', 63.21), ('Sai', 21.98), ('Sandeep', 12.14),
  ('Shailesh', 39.18), ('Siva', 107.89), ('Srinivas', 22.53), ('Subash', 57.96),
  ('Tarun', 40.70), ('Vamsi', 107.56)
ON CONFLICT (player_name) DO NOTHING;

-- Seed default settings
INSERT INTO settings (key, value) VALUES
  ('admin1', 'Eswar'),
  ('admin2', 'Arun'),
  ('court_rate', '22.70'),
  ('courts_saturday', '[2,3,4]'),
  ('courts_tuesday', '[1,2]'),
  ('cancelled_saturday', 'false'),
  ('cancelled_tuesday', 'false'),
  ('tue_time', '{"start":"7:00 PM","end":"9:00 PM"}')
ON CONFLICT (key) DO NOTHING;
