-- Binder: era grouping + the card/instance columns it reads. Additive and re-runnable (IF NOT EXISTS / ON CONFLICT).
-- Deliberately the minimum: no clips, daily packs, drops, shop or ledger changes.
-- Same objects (and the same names) as the ClipDeck migration on the `toosh` branch, so that branch can merge this safely.
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

ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS era_id text REFERENCES eras(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS lore text NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_live_moment boolean NOT NULL DEFAULT false;
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS acquired_via text NOT NULL DEFAULT 'pack';
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS tradable_after timestamptz;
