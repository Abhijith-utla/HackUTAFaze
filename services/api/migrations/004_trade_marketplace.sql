CREATE TABLE market_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 instance_id uuid NOT NULL REFERENCES card_instances(id), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX market_one_open_listing ON market_listings(instance_id) WHERE status='open';
CREATE TABLE market_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES market_listings(id), bidder_id uuid NOT NULL REFERENCES users(id),
 offered_instance_ids uuid[] NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','declined','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
ALTER TABLE card_instances ADD COLUMN market_listing_id uuid REFERENCES market_listings(id), ADD COLUMN market_offer_id uuid REFERENCES market_offers(id);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL,
 message text NOT NULL, offer_id uuid REFERENCES market_offers(id), read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_offer_listing ON market_offers(listing_id);
CREATE INDEX notification_inbox ON notifications(user_id,created_at DESC);
ALTER TABLE card_instances ADD CONSTRAINT card_single_trade_reservation CHECK(num_nonnulls(locked_by_trade_id,market_listing_id,market_offer_id)<=1);
CREATE INDEX market_instance_listing ON card_instances(market_listing_id) WHERE market_listing_id IS NOT NULL;
CREATE INDEX market_instance_offer ON card_instances(market_offer_id) WHERE market_offer_id IS NOT NULL;
