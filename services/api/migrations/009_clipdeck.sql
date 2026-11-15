-- ClipDeck (Tush's spec "ClipDeck — Product & Build Spec", 2026-11-15) on branch `toosh`.
-- Adapts the spec's 12-table model to the existing schema instead of duplicating it:
--   spec card_definitions -> cards (+ columns below), spec card_sets -> card_sets (+ era_id, publish_at),
--   spec ledger -> ledger (reasons widened), spec clips -> clips (new), spec pack_opens -> daily_pack_opens.
-- Re-runnable (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS). Shared by every ClipDeck route.

-- Eras are the sets' grouping (launch eras from the spec).
CREATE TABLE IF NOT EXISTS eras (
  id text PRIMARY KEY,
  name text NOT NULL,
  starts int,
  ends int,
  sort int NOT NULL DEFAULT 0
);
INSERT INTO eras (id, name, starts, ends, sort) VALUES
  ('mw2', 'MW2 Trickshots', 2010, 2012, 1),
  ('house', 'FaZe House', 2013, 2016, 2),
  ('streamer', 'Streamer Era', 2017, 2020, 3),
  ('esports', 'Esports', 2021, NULL, 4)
ON CONFLICT (id) DO NOTHING;

-- Clips: archive clips (staff) and fan submissions. Engagement captured at add time drives rarity.
CREATE TABLE IF NOT EXISTS clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  era_id text REFERENCES eras(id),
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
  likes bigint NOT NULL DEFAULT 0 CHECK (likes >= 0),
  comments bigint NOT NULL DEFAULT 0 CHECK (comments >= 0),
  captured_at timestamptz,
  source text NOT NULL DEFAULT 'archive' CHECK (source IN ('archive','fan')),
  submitted_by uuid REFERENCES users(id),
  clipper_confirmed boolean NOT NULL DEFAULT false,      -- fan confirms they cut it + grants FaZe a licence
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason text,
  auto_flags text[] NOT NULL DEFAULT '{}',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clips_url_uq ON clips (lower(url));
CREATE INDEX IF NOT EXISTS clips_status_idx ON clips (status, created_at);
CREATE INDEX IF NOT EXISTS clips_submitter_idx ON clips (submitted_by, created_at);

-- Card sets get an era and a schedule.
ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS era_id text REFERENCES eras(id);
ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS publish_at timestamptz;

-- Card definitions (spec) = cards (repo) + these fields.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS lore text NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS frame text;                       -- era frame id; null = rarity default
ALTER TABLE cards ADD COLUMN IF NOT EXISTS clip_id uuid REFERENCES clips(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS clipper_user_id uuid REFERENCES users(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS clipper_handle text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rarity_override boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_live_moment boolean NOT NULL DEFAULT false;

-- How an instance was acquired (spec). Existing rows default to 'pack'.
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS acquired_via text NOT NULL DEFAULT 'pack';
ALTER TABLE card_instances DROP CONSTRAINT IF EXISTS card_instances_acquired_via_check;
ALTER TABLE card_instances ADD CONSTRAINT card_instances_acquired_via_check
  CHECK (acquired_via IN ('pack','daily','drop','purchase','trade','clipper','shop_pick','admin'));
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS tradable_after timestamptz;   -- Live Moment cards: +7 days

-- Per-user game state.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pity_count int NOT NULL DEFAULT 0;      -- daily packs since last Legendary
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_days int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_last_day date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_frame text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_skin text;

-- One free daily pack per user per UTC day (the unique row is the guard).
CREATE TABLE IF NOT EXISTS daily_pack_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  instance_ids uuid[] NOT NULL DEFAULT '{}',
  tiers text[] NOT NULL DEFAULT '{}',
  pity_before int NOT NULL DEFAULT 0,
  pity_forced boolean NOT NULL DEFAULT false,
  odds_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

-- Live Moments.
CREATE TABLE IF NOT EXISTS live_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id),
  source text NOT NULL DEFAULT 'simulated' CHECK (source IN ('simulated','twitch')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  claim_count int NOT NULL DEFAULT 0,
  edition_size int,                                   -- frozen at close
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS live_drops_window_idx ON live_drops (starts_at, ends_at);
CREATE TABLE IF NOT EXISTS drop_claims (
  drop_id uuid NOT NULL REFERENCES live_drops(id),
  user_id uuid NOT NULL REFERENCES users(id),
  serial int NOT NULL,
  instance_id uuid REFERENCES card_instances(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, user_id),
  UNIQUE (drop_id, serial)
);

-- Shop: pick-1-of-3 offers (all three shown before choosing) and owned cosmetics.
CREATE TABLE IF NOT EXISTS shop_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  set_id uuid NOT NULL REFERENCES card_sets(id),
  card_ids uuid[] NOT NULL,
  price_coins int NOT NULL,
  chosen_card_id uuid REFERENCES cards(id),
  chosen_instance_id uuid REFERENCES card_instances(id),
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id uuid NOT NULL REFERENCES users(id),
  sku text NOT NULL,
  acquired_via text NOT NULL DEFAULT 'coins' CHECK (acquired_via IN ('coins','set_complete','sol','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sku)
);

-- Rarity overrides and drops are logged with the staff user (spec: staff abuse guard).
CREATE TABLE IF NOT EXISTS rarity_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id),
  from_rarity text NOT NULL,
  to_rarity text NOT NULL,
  staff_id uuid REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Widen enums (superset of everything already allowed, so nothing existing breaks).
ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_reason_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_reason_check CHECK (reason IN (
  'signup_bonus','pack_open','purchase','admin_grant',
  'daily_streak','dust','set_complete','clip_approved','drop_claim','shop_pick','shop_cosmetic'));
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_kind_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_kind_check CHECK (kind IN (
  'display_name','trade_message','fan_art','clip'));
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN (
  'engagement_spike','publish_set','moderate','moderate_submission','close_drop','simulate_hype'));
