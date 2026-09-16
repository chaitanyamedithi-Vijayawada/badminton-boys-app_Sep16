/*
  # Create broadcast_messages table

  1. New Tables
    - `broadcast_messages`
      - `id` (bigserial, primary key)
      - `content` (text) - the message text
      - `sent_by` (text) - name of the sender
      - `created_at` (timestamptz) - when sent

  2. Security
    - Enable RLS
    - Anyone authenticated can read messages
    - Only authenticated users can insert
*/

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id bigserial PRIMARY KEY,
  content text NOT NULL,
  sent_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read broadcast messages"
  ON broadcast_messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert broadcast messages"
  ON broadcast_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);
