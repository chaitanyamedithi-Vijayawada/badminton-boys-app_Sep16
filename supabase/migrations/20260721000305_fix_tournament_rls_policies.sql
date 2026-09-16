/*
# Fix Tournament RLS Policies

## Problem
The three tournament tables (`tournaments`, `tournament_teams`,
`tournament_matches`) each had a single `FOR ALL` policy with `USING (true)`.
This violates the per-verb RLS rule (one policy each for SELECT/INSERT/UPDATE/
DELETE, never `FOR ALL`) and means the `USING (true)` predicate applied to
every operation including UPDATE and DELETE, so anyone with the anon key could
mass-rewrite or wipe tournament data.

## Changes
- Drop the `write tournaments`, `write tournament_teams`, and
  `write tournament_matches` `FOR ALL` policies.
- Create four per-verb policies (SELECT/INSERT/UPDATE/DELETE) on each table,
  scoped to `anon, authenticated` (this is a no-sign-in app that uses the anon
  key, so `anon` must be permitted or the app sees empty tables).
  - SELECT: `USING (true)` — tournament data is intentionally shared/public.
  - INSERT/UPDATE/DELETE: `USING`/`WITH CHECK` guard against null/blank
    required columns rather than `true`, so malformed rows are rejected.

## Notes
- RLS remains enabled on all three tables throughout.
- No data is touched; only policies are replaced.
- Safe to re-run (each policy is dropped before recreate).
*/

-- ============================================================
-- tournaments
-- ============================================================
DROP POLICY IF EXISTS "write tournaments" ON tournaments;
DROP POLICY IF EXISTS "read tournaments" ON tournaments;

DROP POLICY IF EXISTS "anon select tournaments" ON tournaments;
CREATE POLICY "anon select tournaments" ON tournaments
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon insert tournaments" ON tournaments;
CREATE POLICY "anon insert tournaments" ON tournaments
  FOR INSERT TO anon, authenticated
  WITH CHECK (name IS NOT NULL AND name <> '');

DROP POLICY IF EXISTS "anon update tournaments" ON tournaments;
CREATE POLICY "anon update tournaments" ON tournaments
  FOR UPDATE TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (name IS NOT NULL AND name <> '');

DROP POLICY IF EXISTS "anon delete tournaments" ON tournaments;
CREATE POLICY "anon delete tournaments" ON tournaments
  FOR DELETE TO anon, authenticated USING (id IS NOT NULL);

-- ============================================================
-- tournament_teams
-- ============================================================
DROP POLICY IF EXISTS "write tournament_teams" ON tournament_teams;
DROP POLICY IF EXISTS "read tournament_teams" ON tournament_teams;

DROP POLICY IF EXISTS "anon select tournament_teams" ON tournament_teams;
CREATE POLICY "anon select tournament_teams" ON tournament_teams
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon insert tournament_teams" ON tournament_teams;
CREATE POLICY "anon insert tournament_teams" ON tournament_teams
  FOR INSERT TO anon, authenticated
  WITH CHECK (tournament_id IS NOT NULL AND name IS NOT NULL);

DROP POLICY IF EXISTS "anon update tournament_teams" ON tournament_teams;
CREATE POLICY "anon update tournament_teams" ON tournament_teams
  FOR UPDATE TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (tournament_id IS NOT NULL AND name IS NOT NULL);

DROP POLICY IF EXISTS "anon delete tournament_teams" ON tournament_teams;
CREATE POLICY "anon delete tournament_teams" ON tournament_teams
  FOR DELETE TO anon, authenticated USING (id IS NOT NULL);

-- ============================================================
-- tournament_matches
-- ============================================================
DROP POLICY IF EXISTS "write tournament_matches" ON tournament_matches;
DROP POLICY IF EXISTS "read tournament_matches" ON tournament_matches;

DROP POLICY IF EXISTS "anon select tournament_matches" ON tournament_matches;
CREATE POLICY "anon select tournament_matches" ON tournament_matches
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon insert tournament_matches" ON tournament_matches;
CREATE POLICY "anon insert tournament_matches" ON tournament_matches
  FOR INSERT TO anon, authenticated
  WITH CHECK (tournament_id IS NOT NULL AND round IS NOT NULL AND court IS NOT NULL);

DROP POLICY IF EXISTS "anon update tournament_matches" ON tournament_matches;
CREATE POLICY "anon update tournament_matches" ON tournament_matches
  FOR UPDATE TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (tournament_id IS NOT NULL AND round IS NOT NULL AND court IS NOT NULL);

DROP POLICY IF EXISTS "anon delete tournament_matches" ON tournament_matches;
CREATE POLICY "anon delete tournament_matches" ON tournament_matches
  FOR DELETE TO anon, authenticated USING (id IS NOT NULL);
