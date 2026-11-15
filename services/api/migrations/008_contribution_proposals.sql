-- Community-created card and viral-moment pitches. Additive: current local work owns 007.
CREATE TABLE contribution_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  contributor_name text NOT NULL,
  title text NOT NULL,
  pitch text NOT NULL,
  faze_member text NOT NULL,
  source_url text NOT NULL DEFAULT '',
  recipient_wallet text NOT NULL,
  bounty_lamports bigint NOT NULL DEFAULT 0 CHECK (bounty_lamports >= 0 AND bounty_lamports <= 1000000000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','payout_pending','paid')),
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  payout_reference text UNIQUE,
  payout_payer_wallet text,
  payout_signature text UNIQUE,
  payout_cluster text CHECK (payout_cluster IS NULL OR payout_cluster = 'devnet'),
  paid_at timestamptz,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status NOT IN ('approved','payout_pending','paid')) OR bounty_lamports > 0),
  CHECK ((status NOT IN ('payout_pending','paid')) OR (payout_reference IS NOT NULL AND payout_payer_wallet IS NOT NULL AND payout_cluster = 'devnet')),
  CHECK ((status <> 'paid') OR (payout_signature IS NOT NULL AND paid_at IS NOT NULL))
);

CREATE INDEX contribution_proposals_status_created_idx ON contribution_proposals(status, created_at DESC);
CREATE INDEX contribution_proposals_creator_idx ON contribution_proposals(creator_user_id, created_at DESC);
