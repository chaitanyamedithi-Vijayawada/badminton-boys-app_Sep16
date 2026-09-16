/*
  # Create Finance & Hours Management Tables

  1. New Tables
    - `court_payments` - Structured court payment records
      - `id` (serial, primary key)
      - `payment_date` (date, required)
      - `amount` (numeric, required)
      - `hours_purchased` (numeric, required)
      - `notes` (text, optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `misc_expenses` - Miscellaneous expense records
      - `id` (serial, primary key)
      - `expense_date` (date, required)
      - `description` (text, required)
      - `amount` (numeric, required)
      - `quantity` (integer, default 1)
      - `notes` (text, optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `finance_history` - Unified change history for funds and hours
      - `id` (serial, primary key)
      - `history_type` (text: 'funds' or 'hours')
      - `change_type` (text: description of what changed)
      - `previous_value` (numeric)
      - `new_value` (numeric)
      - `reason` (text, optional)
      - `created_at` (timestamptz)

  2. New Settings
    - `opening_balance` - The seed/opening balance amount
    - `hours_override` - JSON with override value, system value, date, reason

  3. Data Migration
    - Seed `opening_balance` from existing fund_entry #1 ($1392.00 "available funds")

  4. Security
    - RLS enabled on all new tables
    - Policies for authenticated and anon read/insert/update access
*/

CREATE TABLE IF NOT EXISTS court_payments (
  id serial PRIMARY KEY,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  hours_purchased numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE court_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read court_payments"
  ON court_payments FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow insert court_payments"
  ON court_payments FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update court_payments"
  ON court_payments FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS misc_expenses (
  id serial PRIMARY KEY,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE misc_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read misc_expenses"
  ON misc_expenses FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow insert misc_expenses"
  ON misc_expenses FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update misc_expenses"
  ON misc_expenses FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS finance_history (
  id serial PRIMARY KEY,
  history_type text NOT NULL DEFAULT 'funds',
  change_type text NOT NULL DEFAULT '',
  previous_value numeric NOT NULL DEFAULT 0,
  new_value numeric NOT NULL DEFAULT 0,
  reason text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE finance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read finance_history"
  ON finance_history FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow insert finance_history"
  ON finance_history FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

INSERT INTO settings (key, value)
VALUES ('opening_balance', '1392.00')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('hours_override', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO court_payments (payment_date, amount, hours_purchased, notes)
VALUES ('2026-04-10', 840.00, 37, 'Initial court payment (migrated from fund entries)');

INSERT INTO finance_history (history_type, change_type, previous_value, new_value, reason)
VALUES
  ('funds', 'Opening balance set', 0, 1392.00, 'Initial opening balance migrated from existing data'),
  ('funds', 'Court payment added', 1392.00, 552.00, 'Court payment: $840.00 for 37hrs (migrated)'),
  ('hours', 'Court hours purchased', 0, 37, 'Initial court payment: 37hrs (migrated)');
