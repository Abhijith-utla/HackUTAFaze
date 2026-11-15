-- FaZe Control Room: sponsors + sponsor activations (lead, contract v1.8). 005 is Moment Scout (Jaideep).
-- Fees are demo contract values for reporting only; no money moves through this table.

CREATE TABLE IF NOT EXISTS sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 80),
  category text NOT NULL CHECK (category IN ('energy_drink','apparel','tech','gaming_hardware','food_beverage','auto','entertainment','other')),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  demo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsor_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  fee_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (fee_usd >= 0),     -- demo contract value
  deliverables text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (sponsor_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS sponsor_activations_campaign_idx ON sponsor_activations(campaign_id);
