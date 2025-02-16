/*
  # Create meditation sessions table

  1. New Tables
    - `meditation_sessions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `duration_minutes` (integer)
      - `distractions` (integer)
      - `completed_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `meditation_sessions` table
    - Add policies for authenticated users to:
      - Insert their own sessions
      - Read their own sessions
*/

CREATE TABLE IF NOT EXISTS meditation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  duration_minutes integer NOT NULL,
  distractions integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE meditation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own sessions"
  ON meditation_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own sessions"
  ON meditation_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);