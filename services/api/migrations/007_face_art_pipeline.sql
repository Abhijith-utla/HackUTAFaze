-- Clip / frame -> best face -> composed card art (A, lead-approved; contract v1.9 draft). Admin-only.
-- 005 is reserved for Moment Scout, 006 is sponsors. Re-runnable (IF NOT EXISTS).
-- Face DETECTION + quality scoring only: no recognition, no embeddings, no landmarks stored.
-- Frames and candidate crops stay private in these tables. Only a pick writes card_art, and only
-- onto a Moment Studio draft asset (campaign_assets), which still needs review + rights to launch.
-- Nothing here writes to `cards`.

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('face_art','face_frame')),               -- MP4 upload | single still frame
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  source_label text NOT NULL CHECK (length(source_label) BETWEEN 1 AND 120),
  source_url text CHECK (source_url IS NULL OR source_url ~ '^https?://'),     -- reference metadata only, never fetched
  source_frame_ms integer CHECK (source_frame_ms IS NULL OR source_frame_ms >= 0), -- face_frame: offset in the clip/VOD
  source_frame_at timestamptz,                                                -- face_frame: wall-clock capture time
  source_sha256 text NOT NULL,                                                -- of the upload (an MP4 itself is not kept)
  source_bytes integer NOT NULL CHECK (source_bytes > 0),
  rights_confirmed boolean NOT NULL CHECK (rights_confirmed),                 -- a job cannot exist without it
  rights_note text NOT NULL CHECK (length(btrim(rights_note)) >= 3),
  stats jsonb NOT NULL DEFAULT '{}',                                          -- {frames, faces, ms:{...}}
  error text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_jobs_status_idx ON pipeline_jobs(status, created_at);

-- Private source frames kept for re-cropping at pick time (face_frame: the one frame; face_art: the candidates' frames).
CREATE TABLE IF NOT EXISTS pipeline_frames (
  job_id uuid NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  frame_no integer NOT NULL CHECK (frame_no >= 0),
  frame_ms integer CHECK (frame_ms IS NULL OR frame_ms >= 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 8388608),
  PRIMARY KEY (job_id, frame_no)
);

CREATE TABLE IF NOT EXISTS pipeline_candidates (
  job_id uuid NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  frame_no integer NOT NULL,
  frame_ms integer CHECK (frame_ms IS NULL OR frame_ms >= 0),                -- timestamp of the source frame (null: still with no offset)
  scores jsonb NOT NULL,                                                      -- {confidence,size,sharpness,frontal,exposure,total}
  crop_box jsonb NOT NULL,                                                    -- 5:6 head-and-shoulders crop {x,y,w,h} in frame px (not a face landmark)
  width integer NOT NULL CHECK (width > 0),                                   -- preview size
  height integer NOT NULL CHECK (height > 0),
  low_res boolean NOT NULL DEFAULT false,
  mime text NOT NULL DEFAULT 'image/webp' CHECK (mime = 'image/webp'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),    -- private preview; never served by /art
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, rank),
  FOREIGN KEY (job_id, frame_no) REFERENCES pipeline_frames(job_id, frame_no) ON DELETE CASCADE
);

-- Where a Studio draft asset's art came from (shown on the draft for the reviewer).
-- Dropped with the asset (regenerate deletes and recreates assets).
CREATE TABLE IF NOT EXISTS campaign_asset_art_sources (
  asset_id uuid PRIMARY KEY REFERENCES campaign_assets(id) ON DELETE CASCADE,
  art_url text NOT NULL,
  job_id uuid REFERENCES pipeline_jobs(id) ON DELETE SET NULL,
  rank smallint,                                                              -- null when the admin drew a custom box
  crop_box jsonb NOT NULL,
  frame_ms integer,
  frame_at timestamptz,
  source_label text NOT NULL,
  source_url text,
  rights_note text NOT NULL,
  picked_by uuid NOT NULL REFERENCES users(id),
  picked_at timestamptz NOT NULL DEFAULT now()
);
