-- Direct SOL pack purchases use the same globally unique transaction signatures as coin purchases.
ALTER TABLE purchases ADD COLUMN pack_snapshot jsonb, ADD COLUMN pack_pull_id uuid REFERENCES pulls(id);
CREATE INDEX pending_pack_purchases ON purchases(user_id,created_at DESC) WHERE pack_snapshot IS NOT NULL;
