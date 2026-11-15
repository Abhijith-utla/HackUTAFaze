-- Moment Scout: metadata previews, not card art. Editorial decisions survive metadata expiry.
CREATE TABLE IF NOT EXISTS scout_source (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  next_page text,
  completed boolean NOT NULL DEFAULT false,
  pages_scanned integer NOT NULL DEFAULT 0,
  last_scan_at timestamptz
);
INSERT INTO scout_source (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS scout_candidates (
  video_id text PRIMARY KEY CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  metadata jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','shortlisted','rejected','promoted')),
  note text NOT NULL DEFAULT '',
  editorial_summary text NOT NULL DEFAULT '',
  moment_id uuid REFERENCES archive_moments(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scout_candidates_status_idx ON scout_candidates(status);
CREATE INDEX IF NOT EXISTS scout_candidates_fetched_idx ON scout_candidates(fetched_at) WHERE metadata IS NOT NULL;

-- Lead's KAM hook reads fresh counts here; no API metrics enter durable card lore.
CREATE OR REPLACE VIEW scout_moment_views AS
SELECT 'yt:' || video_id AS moment_key, (metadata->>'views')::bigint AS views, fetched_at
FROM scout_candidates
WHERE status='promoted' AND metadata->>'views' IS NOT NULL
  AND fetched_at > now()-interval '30 days';
