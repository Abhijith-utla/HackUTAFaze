-- Battles demo slice (Agent A, contract v1.9 draft; design "Game logic v1").
-- 005 = Moment Scout, 006 = sponsors, 007 = face-art pipeline (in progress elsewhere). Re-runnable.
-- Battles never touch the ledger, never lock or consume cards; rewards are XP + badges only.

-- Battle role per FaZe member (content decision; unknown members fall back to 'creator' in code).
CREATE TABLE IF NOT EXISTS member_roles (
  faze_member text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('founder','og','creator','pro')),
  demo boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO member_roles (faze_member, role) VALUES
  ('FaZe Apex','founder'), ('FaZe Rain','og'),
  ('FaZe Banks','creator'), ('FaZe Adapt','creator'), ('FaZe Rug','creator')
ON CONFLICT (faze_member) DO NOTHING;

-- One boss per UTC day per tier (1 Rookie .. 4 Legend). Built lazily and cached; lineup is a stat snapshot.
CREATE TABLE IF NOT EXISTS vault_bosses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  tier integer NOT NULL CHECK (tier BETWEEN 1 AND 4),
  name text NOT NULL,
  lineup jsonb NOT NULL,                       -- [{card, stats, setKey, member}] x3
  cost_cap integer CHECK (cost_cap IS NULL OR cost_cap > 0),
  campaign_id uuid REFERENCES campaigns(id),
  rules_version integer NOT NULL DEFAULT 1,
  demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, tier)
);

CREATE TABLE IF NOT EXISTS battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('vault','practice')),
  tier integer CHECK (tier IS NULL OR tier BETWEEN 1 AND 4),
  boss_id uuid REFERENCES vault_bosses(id),
  seed text NOT NULL,                          -- 32 hex chars from crypto.randomBytes(16)
  rules_version integer NOT NULL,
  lineup_instance_ids uuid[] NOT NULL CHECK (cardinality(lineup_instance_ids) = 3),
  player_lineup jsonb NOT NULL,                -- stat snapshot at battle time (hype included)
  opponent jsonb NOT NULL,                     -- {name, lineup:[{card, stats, setKey, member}]}
  rounds jsonb NOT NULL,                       -- resolver log
  result text NOT NULL CHECK (result IN ('win','loss')),
  player_points integer NOT NULL,
  opponent_points integer NOT NULL,
  rewards jsonb NOT NULL DEFAULT '{}',         -- {xp, badge?}
  idempotency_key text NOT NULL,
  demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK ((mode = 'vault') = (boss_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS battles_user_created_idx ON battles (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS battles_user_boss_idx ON battles (user_id, boss_id) WHERE boss_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS battle_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  vault_clears jsonb NOT NULL DEFAULT '[]',    -- [{day, tier, battleId}]
  badges jsonb NOT NULL DEFAULT '[]',          -- [{id, label, battleId, earnedAt}]
  updated_at timestamptz NOT NULL DEFAULT now()
);
