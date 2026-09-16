/*
  # Fix broadcast_messages RLS for anonymous access

  The app uses the Supabase anon key without Supabase Auth,
  so the existing `TO authenticated` policies block all access.
  Replace them with anon-accessible policies.

  1. Changes
    - Drop existing authenticated-only SELECT and INSERT policies
    - Add anon SELECT policy (anyone can read broadcasts)
    - Add anon INSERT policy (anyone can send broadcasts — admin PIN enforced in app)
*/

DROP POLICY IF EXISTS "Authenticated users can read broadcast messages" ON broadcast_messages;
DROP POLICY IF EXISTS "Authenticated users can insert broadcast messages" ON broadcast_messages;

CREATE POLICY "Anon users can read broadcast messages"
  ON broadcast_messages FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert broadcast messages"
  ON broadcast_messages FOR INSERT
  TO anon
  WITH CHECK (true);
