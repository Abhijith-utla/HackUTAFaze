-- Demo experience: finished card faces, guaranteed pack slots, stream-moment claims. Additive and re-runnable.
-- Constraint widenings below are supersets of every value any branch already uses, so existing rows stay valid.

-- Cards whose artwork already contains the title, date, lore and frame (the client shows the image as-is), plus an
-- optional hype narration script (the audio file is public/voice/<card id>.mp3; the script is what a future voice agent reads).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS face_baked boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS voice_script text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS lore text NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_live_moment boolean NOT NULL DEFAULT false;

-- Guaranteed slots: [{"slot":4,"label":"...","cardIds":[uuid,...]}]. The server still picks which card with a CSPRNG.
ALTER TABLE packs ADD COLUMN IF NOT EXISTS fixed_slots jsonb;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_reason_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_reason_check CHECK (reason IN (
  'signup_bonus','pack_open','purchase','admin_grant',
  'daily_streak','dust','set_complete','clip_approved','drop_claim','shop_pick','shop_cosmetic','moment_claim'));

ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS acquired_via text NOT NULL DEFAULT 'pack';
ALTER TABLE card_instances DROP CONSTRAINT IF EXISTS card_instances_acquired_via_check;
ALTER TABLE card_instances ADD CONSTRAINT card_instances_acquired_via_check CHECK (acquired_via IN (
  'pack','daily','drop','purchase','trade','clipper','shop_pick','admin','fuse','moment'));

-- A card collected live from a stream when chat spiked. One per user per card (demo).
CREATE TABLE IF NOT EXISTS stream_moment_claims (
  user_id uuid NOT NULL REFERENCES users(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  instance_id uuid REFERENCES card_instances(id),
  channel text NOT NULL DEFAULT '',
  hype_score numeric,
  idempotency_key text NOT NULL,
  price_coins integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id),
  UNIQUE (user_id, idempotency_key)
);
