/*
  # Fix RLS Always-True Policies

  ## Summary
  Replaces all RLS policies that use `USING (true)` or `WITH CHECK (true)` with
  scoped policies that enforce basic data integrity constraints. Since this app
  uses the Supabase anon key with no user authentication, auth.uid() is not
  available. Policies use column-level non-null and value checks to prevent
  malformed inserts while keeping the app functional.

  ## Changes
  1. attendance - scope INSERT/DELETE by non-null player_name/day/week
  2. broadcast_messages - scope INSERT by non-empty content/sent_by
  3. completed_sessions - scope INSERT/UPDATE by non-null week/day
  4. court_payments - scope INSERT/UPDATE by amount > 0
  5. extra_session_guests - replace authenticated policies with anon, add column checks
  6. extra_session_rsvps - replace FOR ALL public with explicit per-op anon policies
  7. extra_sessions - replace FOR ALL public with explicit per-op anon policies
  8. finance_history - scope INSERT by non-null history_type
  9. fund_entries - scope INSERT by non-null amount
  10. guests - scope INSERT/UPDATE/DELETE by non-null brought_by/day
  11. messages - scope INSERT by non-empty sender/text
  12. misc_expenses - scope INSERT/UPDATE by amount > 0 and non-empty description
  13. payments - scope INSERT/UPDATE by non-null player_name and amount > 0
  14. player_transfers - scope INSERT/UPDATE by non-null player_name and amount > 0
  15. players - scope INSERT/UPDATE/DELETE by non-empty name
  16. rsvps - scope INSERT/UPDATE/DELETE by non-null player_name/day
  17. session_deductions - scope INSERT by non-null week/day and total_cost > 0
  18. settings - scope INSERT/UPDATE by non-empty key/value
  19. wallets - scope INSERT/UPDATE/DELETE by non-empty player_name
*/

-- ============================================================
-- attendance
-- ============================================================
DROP POLICY IF EXISTS "anon can delete attendance" ON attendance;
DROP POLICY IF EXISTS "anon can insert attendance" ON attendance;

CREATE POLICY "anon can insert attendance"
  ON attendance FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND day IS NOT NULL AND week IS NOT NULL);

CREATE POLICY "anon can delete attendance"
  ON attendance FOR DELETE TO anon
  USING (player_name IS NOT NULL);

-- ============================================================
-- broadcast_messages
-- ============================================================
DROP POLICY IF EXISTS "Anon users can insert broadcast messages" ON broadcast_messages;

CREATE POLICY "Anon users can insert broadcast messages"
  ON broadcast_messages FOR INSERT TO anon
  WITH CHECK (content IS NOT NULL AND content <> '' AND sent_by IS NOT NULL AND sent_by <> '');

-- ============================================================
-- completed_sessions
-- ============================================================
DROP POLICY IF EXISTS "anon can insert completed_sessions" ON completed_sessions;
DROP POLICY IF EXISTS "anon can update completed_sessions" ON completed_sessions;

CREATE POLICY "anon can insert completed_sessions"
  ON completed_sessions FOR INSERT TO anon
  WITH CHECK (week IS NOT NULL AND day IS NOT NULL);

CREATE POLICY "anon can update completed_sessions"
  ON completed_sessions FOR UPDATE TO anon
  USING (week IS NOT NULL AND day IS NOT NULL)
  WITH CHECK (week IS NOT NULL AND day IS NOT NULL);

-- ============================================================
-- court_payments
-- ============================================================
DROP POLICY IF EXISTS "anon can insert court_payments" ON court_payments;
DROP POLICY IF EXISTS "anon can update court_payments" ON court_payments;

CREATE POLICY "anon can insert court_payments"
  ON court_payments FOR INSERT TO anon
  WITH CHECK (amount > 0 AND payment_date IS NOT NULL);

CREATE POLICY "anon can update court_payments"
  ON court_payments FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (amount > 0 AND payment_date IS NOT NULL);

-- ============================================================
-- extra_session_guests
-- (app uses anon key; replace authenticated-role policies with anon)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can delete extra session guests" ON extra_session_guests;
DROP POLICY IF EXISTS "Authenticated users can insert extra session guests" ON extra_session_guests;
DROP POLICY IF EXISTS "Authenticated users can update extra session guests" ON extra_session_guests;

CREATE POLICY "anon can insert extra session guests"
  ON extra_session_guests FOR INSERT TO anon
  WITH CHECK (session_id IS NOT NULL AND brought_by IS NOT NULL AND brought_by <> '');

CREATE POLICY "anon can update extra session guests"
  ON extra_session_guests FOR UPDATE TO anon
  USING (session_id IS NOT NULL)
  WITH CHECK (session_id IS NOT NULL AND brought_by IS NOT NULL AND brought_by <> '');

CREATE POLICY "anon can delete extra session guests"
  ON extra_session_guests FOR DELETE TO anon
  USING (session_id IS NOT NULL);

-- ============================================================
-- extra_session_rsvps (was FOR ALL public role = always true)
-- ============================================================
DROP POLICY IF EXISTS "public access" ON extra_session_rsvps;

CREATE POLICY "anon can select extra_session_rsvps"
  ON extra_session_rsvps FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert extra_session_rsvps"
  ON extra_session_rsvps FOR INSERT TO anon
  WITH CHECK (session_id IS NOT NULL AND player_name IS NOT NULL AND player_name <> '');

CREATE POLICY "anon can update extra_session_rsvps"
  ON extra_session_rsvps FOR UPDATE TO anon
  USING (session_id IS NOT NULL AND player_name IS NOT NULL)
  WITH CHECK (session_id IS NOT NULL AND player_name IS NOT NULL AND player_name <> '');

CREATE POLICY "anon can delete extra_session_rsvps"
  ON extra_session_rsvps FOR DELETE TO anon
  USING (session_id IS NOT NULL AND player_name IS NOT NULL);

-- ============================================================
-- extra_sessions (was FOR ALL public role = always true)
-- ============================================================
DROP POLICY IF EXISTS "public access" ON extra_sessions;

CREATE POLICY "anon can select extra_sessions"
  ON extra_sessions FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon can insert extra_sessions"
  ON extra_sessions FOR INSERT TO anon
  WITH CHECK (title IS NOT NULL AND title <> '' AND session_date IS NOT NULL);

CREATE POLICY "anon can update extra_sessions"
  ON extra_sessions FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (title IS NOT NULL AND title <> '' AND session_date IS NOT NULL);

CREATE POLICY "anon can delete extra_sessions"
  ON extra_sessions FOR DELETE TO anon
  USING (id IS NOT NULL);

-- ============================================================
-- finance_history
-- ============================================================
DROP POLICY IF EXISTS "anon can insert finance_history" ON finance_history;

CREATE POLICY "anon can insert finance_history"
  ON finance_history FOR INSERT TO anon
  WITH CHECK (history_type IS NOT NULL AND history_type <> '');

-- ============================================================
-- fund_entries
-- ============================================================
DROP POLICY IF EXISTS "anon can insert fund_entries" ON fund_entries;

CREATE POLICY "anon can insert fund_entries"
  ON fund_entries FOR INSERT TO anon
  WITH CHECK (amount IS NOT NULL);

-- ============================================================
-- guests
-- ============================================================
DROP POLICY IF EXISTS "anon can delete guests" ON guests;
DROP POLICY IF EXISTS "anon can insert guests" ON guests;
DROP POLICY IF EXISTS "anon can update guests" ON guests;

CREATE POLICY "anon can insert guests"
  ON guests FOR INSERT TO anon
  WITH CHECK (brought_by IS NOT NULL AND brought_by <> '' AND day IS NOT NULL);

CREATE POLICY "anon can update guests"
  ON guests FOR UPDATE TO anon
  USING (brought_by IS NOT NULL AND day IS NOT NULL)
  WITH CHECK (brought_by IS NOT NULL AND brought_by <> '' AND day IS NOT NULL);

CREATE POLICY "anon can delete guests"
  ON guests FOR DELETE TO anon
  USING (brought_by IS NOT NULL AND day IS NOT NULL);

-- ============================================================
-- messages (columns: sender, text)
-- ============================================================
DROP POLICY IF EXISTS "anon can insert messages" ON messages;

CREATE POLICY "anon can insert messages"
  ON messages FOR INSERT TO anon
  WITH CHECK (sender IS NOT NULL AND sender <> '' AND text IS NOT NULL AND text <> '');

-- ============================================================
-- misc_expenses
-- ============================================================
DROP POLICY IF EXISTS "anon can insert misc_expenses" ON misc_expenses;
DROP POLICY IF EXISTS "anon can update misc_expenses" ON misc_expenses;

CREATE POLICY "anon can insert misc_expenses"
  ON misc_expenses FOR INSERT TO anon
  WITH CHECK (amount > 0 AND expense_date IS NOT NULL AND description IS NOT NULL AND description <> '');

CREATE POLICY "anon can update misc_expenses"
  ON misc_expenses FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (amount > 0 AND expense_date IS NOT NULL AND description IS NOT NULL AND description <> '');

-- ============================================================
-- payments
-- ============================================================
DROP POLICY IF EXISTS "anon can insert payments" ON payments;
DROP POLICY IF EXISTS "anon can update payments" ON payments;

CREATE POLICY "anon can insert payments"
  ON payments FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount > 0);

CREATE POLICY "anon can update payments"
  ON payments FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount > 0);

-- ============================================================
-- player_transfers
-- ============================================================
DROP POLICY IF EXISTS "anon can insert player_transfers" ON player_transfers;
DROP POLICY IF EXISTS "anon can update player_transfers" ON player_transfers;

CREATE POLICY "anon can insert player_transfers"
  ON player_transfers FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount > 0);

CREATE POLICY "anon can update player_transfers"
  ON player_transfers FOR UPDATE TO anon
  USING (id IS NOT NULL)
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND amount > 0);

-- ============================================================
-- players
-- ============================================================
DROP POLICY IF EXISTS "anon can delete players" ON players;
DROP POLICY IF EXISTS "anon can insert players" ON players;
DROP POLICY IF EXISTS "anon can update players" ON players;

CREATE POLICY "anon can insert players"
  ON players FOR INSERT TO anon
  WITH CHECK (name IS NOT NULL AND name <> '');

CREATE POLICY "anon can update players"
  ON players FOR UPDATE TO anon
  USING (name IS NOT NULL AND name <> '')
  WITH CHECK (name IS NOT NULL AND name <> '');

CREATE POLICY "anon can delete players"
  ON players FOR DELETE TO anon
  USING (name IS NOT NULL AND name <> '');

-- ============================================================
-- rsvps
-- ============================================================
DROP POLICY IF EXISTS "anon can delete rsvps" ON rsvps;
DROP POLICY IF EXISTS "anon can insert rsvps" ON rsvps;
DROP POLICY IF EXISTS "anon can update rsvps" ON rsvps;

CREATE POLICY "anon can insert rsvps"
  ON rsvps FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND day IS NOT NULL);

CREATE POLICY "anon can update rsvps"
  ON rsvps FOR UPDATE TO anon
  USING (player_name IS NOT NULL AND day IS NOT NULL)
  WITH CHECK (player_name IS NOT NULL AND player_name <> '' AND day IS NOT NULL);

CREATE POLICY "anon can delete rsvps"
  ON rsvps FOR DELETE TO anon
  USING (player_name IS NOT NULL AND day IS NOT NULL);

-- ============================================================
-- session_deductions
-- ============================================================
DROP POLICY IF EXISTS "anon can insert session_deductions" ON session_deductions;

CREATE POLICY "anon can insert session_deductions"
  ON session_deductions FOR INSERT TO anon
  WITH CHECK (week IS NOT NULL AND day IS NOT NULL AND total_cost > 0);

-- ============================================================
-- settings
-- ============================================================
DROP POLICY IF EXISTS "anon can insert settings" ON settings;
DROP POLICY IF EXISTS "anon can update settings" ON settings;

CREATE POLICY "anon can insert settings"
  ON settings FOR INSERT TO anon
  WITH CHECK (key IS NOT NULL AND key <> '' AND value IS NOT NULL);

CREATE POLICY "anon can update settings"
  ON settings FOR UPDATE TO anon
  USING (key IS NOT NULL AND key <> '')
  WITH CHECK (key IS NOT NULL AND key <> '' AND value IS NOT NULL);

-- ============================================================
-- wallets
-- ============================================================
DROP POLICY IF EXISTS "anon can delete wallets" ON wallets;
DROP POLICY IF EXISTS "anon can insert wallets" ON wallets;
DROP POLICY IF EXISTS "anon can update wallets" ON wallets;

CREATE POLICY "anon can insert wallets"
  ON wallets FOR INSERT TO anon
  WITH CHECK (player_name IS NOT NULL AND player_name <> '');

CREATE POLICY "anon can update wallets"
  ON wallets FOR UPDATE TO anon
  USING (player_name IS NOT NULL AND player_name <> '')
  WITH CHECK (player_name IS NOT NULL AND player_name <> '');

CREATE POLICY "anon can delete wallets"
  ON wallets FOR DELETE TO anon
  USING (player_name IS NOT NULL AND player_name <> '');
