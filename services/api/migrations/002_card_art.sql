-- v1.5: card art lives in the database; artUrl is stored relative.
CREATE TABLE IF NOT EXISTS card_art (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) > 0 AND octet_length(bytes) <= 2097152),
  sha256 text NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_art_sha256_idx ON card_art(sha256);

-- Fan-art submissions point at their private card_art row via payload->>'artId'
-- (GET /art withholds those bytes until the submission is approved).
CREATE INDEX IF NOT EXISTS submissions_fan_art_id_idx ON submissions ((payload->>'artId')) WHERE kind = 'fan_art';

-- Backfill: v1.4 baked absolute API URLs (e.g. http://localhost:4000/art/...) into rows.
-- Strip scheme+host only for this API's own art routes; external URLs stay as given.
UPDATE cards
   SET art_url = regexp_replace(art_url, '^https?://[^/]+(?=/(art|uploaded-art|demo-art)/)', '')
 WHERE art_url ~ '^https?://[^/]+/(art|uploaded-art|demo-art)/';
