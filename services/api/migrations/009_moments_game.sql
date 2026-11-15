-- v1.9 moments game (lead-approved 2026-11-15): cards carry archive lore, sets are eras with a
-- completion bonus + backstory, a free daily pack (once per UTC day), and one-time set claims.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS lore text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS moment_on date,
  ADD COLUMN IF NOT EXISTS moment_key text;            -- archive_moments.key this card captures

ALTER TABLE card_sets
  ADD COLUMN IF NOT EXISTS era text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS backstory text NOT NULL DEFAULT '',   -- revealed to a fan once they complete the set
  ADD COLUMN IF NOT EXISTS completion_bonus integer NOT NULL DEFAULT 0 CHECK (completion_bonus >= 0);

-- Daily packs are never sold: GET /packs and POST /packs/:id/open ignore them.
ALTER TABLE packs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'store' CHECK (kind IN ('store','daily'));

-- New coin source: completing a set (one-time, idempotent via ledger key set_bonus:<user>:<set>).
ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_reason_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_reason_check
  CHECK (reason IN ('signup_bonus','pack_open','purchase','admin_grant','set_bonus'));

-- One free daily pack per fan per UTC day. The primary key is the guarantee.
CREATE TABLE IF NOT EXISTS daily_claims (
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  pull_id uuid NOT NULL REFERENCES pulls(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS set_claims (
  user_id uuid NOT NULL REFERENCES users(id),
  set_id uuid NOT NULL REFERENCES card_sets(id),
  bonus integer NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);
