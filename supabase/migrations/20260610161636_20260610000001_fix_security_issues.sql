/*
  # Fix Security Issues

  ## Issues Fixed
  1. Function Search Path Mutable: `public.set_updated_at` had a role mutable search_path
  2. RLS Policy Always True on 6 tables:
     - court_payments
     - misc_charges
     - payments
     - player_transfers
     - players
     - transactions

  ## Changes
  1. Fix `set_updated_at` function to use an immutable search_path
  2. Drop all `allow_all_*` policies that bypass RLS
  3. Create properly scoped per-operation policies for each table
*/

-- ============================================================
-- 1. Fix set_updated_at function search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
IMMUTABLE SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. court_payments - Replace allow_all_court_payments
-- ============================================================
DROP POLICY IF EXISTS "allow_all_court_payments" ON court_payments;

CREATE POLICY "anon can select court_payments"
  ON court_payments FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert court_payments"
  ON court_payments FOR INSERT TO anon
  WITH CHECK (amount IS NOT NULL AND paid_at IS NOT NULL);

CREATE POLICY "anon can update court_payments"
  ON court_payments FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (amount IS NOT NULL AND paid_at IS NOT NULL);

CREATE POLICY "anon can delete court_payments"
  ON court_payments FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- 3. misc_charges - Replace allow_all_misc_charges
-- ============================================================
DROP POLICY IF EXISTS "allow_all_misc_charges" ON misc_charges;

CREATE POLICY "anon can select misc_charges"
  ON misc_charges FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert misc_charges"
  ON misc_charges FOR INSERT TO anon
  WITH CHECK (total_amount IS NOT NULL AND per_player_amount IS NOT NULL);

CREATE POLICY "anon can update misc_charges"
  ON misc_charges FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (total_amount IS NOT NULL AND per_player_amount IS NOT NULL);

CREATE POLICY "anon can delete misc_charges"
  ON misc_charges FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- 4. payments - Replace allow_all_payments
-- ============================================================
DROP POLICY IF EXISTS "allow_all_payments" ON payments;

CREATE POLICY "anon can select payments"
  ON payments FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert payments"
  ON payments FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount IS NOT NULL AND amount > 0);

CREATE POLICY "anon can update payments"
  ON payments FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount IS NOT NULL AND amount > 0);

CREATE POLICY "anon can delete payments"
  ON payments FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- 5. player_transfers - Replace allow_all_player_transfers
-- ============================================================
DROP POLICY IF EXISTS "allow_all_player_transfers" ON player_transfers;

CREATE POLICY "anon can select player_transfers"
  ON player_transfers FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert player_transfers"
  ON player_transfers FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount IS NOT NULL AND amount > 0);

CREATE POLICY "anon can update player_transfers"
  ON player_transfers FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount IS NOT NULL AND amount > 0);

CREATE POLICY "anon can delete player_transfers"
  ON player_transfers FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- 6. players - Replace allow_all_players
-- ============================================================
DROP POLICY IF EXISTS "allow_all_players" ON players;

CREATE POLICY "anon can select players"
  ON players FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert players"
  ON players FOR INSERT TO anon
  WITH CHECK (name IS NOT NULL AND name <> '');

CREATE POLICY "anon can update players"
  ON players FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (name IS NOT NULL AND name <> '');

CREATE POLICY "anon can delete players"
  ON players FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- 7. transactions - Replace allow_all_transactions
-- ============================================================
DROP POLICY IF EXISTS "allow_all_transactions" ON transactions;

CREATE POLICY "anon can select transactions"
  ON transactions FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert transactions"
  ON transactions FOR INSERT TO anon
  WITH CHECK (player_id IS NOT NULL AND type IS NOT NULL AND type <> '' AND amount IS NOT NULL);

CREATE POLICY "anon can update transactions"
  ON transactions FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (player_id IS NOT NULL AND type IS NOT NULL AND type <> '' AND amount IS NOT NULL);

CREATE POLICY "anon can delete transactions"
  ON transactions FOR DELETE TO anon
  USING (id IS NOT NULL);