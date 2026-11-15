-- Contract v1 (docs/data-model.md). Every table lives here, including ones other agents write.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'fan' CHECK (role IN ('fan','admin')),
  display_name_status text NOT NULL DEFAULT 'pending' CHECK (display_name_status IN ('pending','approved','rejected')),
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('signup_bonus','pack_open','purchase','admin_grant')),
  ref_id text,
  idempotency_key text NOT NULL UNIQUE,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger(user_id);

CREATE TABLE card_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','retired')),
  demo boolean NOT NULL DEFAULT false,
  published_at timestamptz
);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES card_sets(id),
  name text NOT NULL,
  faze_member text NOT NULL,
  rarity text NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  art_url text NOT NULL DEFAULT '',
  base_power integer NOT NULL DEFAULT 0,
  max_supply integer CHECK (max_supply IS NULL OR max_supply > 0),
  demo boolean NOT NULL DEFAULT false
);
CREATE INDEX cards_set_idx ON cards(set_id);

CREATE TABLE card_stats (
  card_id uuid PRIMARY KEY REFERENCES cards(id),
  hype integer NOT NULL DEFAULT 0 CHECK (hype BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES card_sets(id),
  name text NOT NULL,
  price_coins integer NOT NULL CHECK (price_coins > 0),
  cards_per_pack integer NOT NULL CHECK (cards_per_pack > 0),
  odds jsonb NOT NULL,
  odds_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES users(id),
  to_user_id uuid NOT NULL REFERENCES users(id),
  offered_instance_ids uuid[] NOT NULL DEFAULT '{}',
  requested_instance_ids uuid[] NOT NULL DEFAULT '{}',
  message text,
  message_status text CHECK (message_status IN ('pending','approved','rejected')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE card_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  serial integer NOT NULL CHECK (serial > 0),
  locked_by_trade_id uuid REFERENCES trades(id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, serial)
);
CREATE INDEX card_instances_owner_idx ON card_instances(owner_id);

CREATE TABLE pulls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  pack_id uuid NOT NULL REFERENCES packs(id),
  odds_version integer NOT NULL,
  card_instance_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  bundle_id text NOT NULL,
  coins integer NOT NULL,
  lamports bigint NOT NULL,
  reference text NOT NULL UNIQUE,            -- Solana Pay reference pubkey (server-generated)
  recipient text NOT NULL,                   -- treasury pubkey
  tx_signature text UNIQUE,
  cluster text NOT NULL DEFAULT 'devnet' CHECK (cluster = 'devnet'),
  test_mode boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('display_name','trade_message','fan_art')),
  ref_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  auto_flags text[] NOT NULL DEFAULT '{}',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_status_idx ON submissions(status);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('engagement_spike','publish_set','moderate')),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queued_idx ON jobs(created_at) WHERE status = 'queued';

CREATE TABLE engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faze_member text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('views','likes','mentions')),
  value integer NOT NULL,
  simulated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
