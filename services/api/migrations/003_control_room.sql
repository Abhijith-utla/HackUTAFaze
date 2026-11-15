-- FaZe Control Room (lead, contract v1.6). New tables only; nothing in 001 changes.
-- 002 is reserved for A's card_art migration (contract v1.5).

-- Historical archive KAM mines. Loaded from content/archive/faze-timeline.json (page-cited).
CREATE TABLE archive_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,                         -- stable id from the archive file
  occurred_on date NOT NULL,
  precision text NOT NULL CHECK (precision IN ('day','month','year')),
  title text NOT NULL,
  summary text NOT NULL,
  members text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  source text NOT NULL,
  citations text[] NOT NULL DEFAULT '{}',
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(members, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  ) STORED
);
CREATE INDEX archive_moments_search_idx ON archive_moments USING gin (search);
CREATE INDEX archive_moments_members_idx ON archive_moments USING gin (members);

-- KAM's ranked, explainable recommendations.
CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES archive_moments(id),
  score numeric(6,2) NOT NULL,
  signals jsonb NOT NULL,                           -- [{label, value, weight, points, detail}]
  recommendation text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','dismissed')),
  scan_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_scan_idx ON opportunities(scan_id, score DESC);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES opportunities(id),
  moment_id uuid REFERENCES archive_moments(id),
  name text NOT NULL,
  pitch text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','rejected','live','ended')),
  generator text NOT NULL DEFAULT 'template',       -- 'template' | 'ollama:<model>'
  rights_confirmed boolean NOT NULL DEFAULT false,
  rights_note text NOT NULL DEFAULT '',
  pack_price_coins integer NOT NULL DEFAULT 150 CHECK (pack_price_coins > 0),
  set_id uuid REFERENCES card_sets(id),             -- created at launch through the admin API
  pack_id uuid REFERENCES packs(id),
  created_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  launched_at timestamptz,
  ended_at timestamptz,
  demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_status_idx ON campaigns(status);

-- Generated drafts: one row per card (+ lore). Becomes a real card at launch.
CREATE TABLE campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  faze_member text NOT NULL,
  rarity text NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  lore text NOT NULL,
  art_url text NOT NULL DEFAULT '',
  base_power integer NOT NULL DEFAULT 0,
  max_supply integer CHECK (max_supply IS NULL OR max_supply > 0),
  duplicate_of uuid REFERENCES cards(id),
  similarity numeric(4,3),
  card_id uuid REFERENCES cards(id),                -- set at launch
  UNIQUE (campaign_id, position)
);

-- Append-only record of every Control Room action.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);

-- Attribute pulls to a campaign without touching A's pulls table: campaign packs are looked up by pack_id.
