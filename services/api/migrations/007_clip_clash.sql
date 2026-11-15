CREATE TABLE clip_clash_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mime text NOT NULL CHECK(mime IN ('video/mp4','video/webm','image/png','image/jpeg')),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 20971520), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cards
 ADD clip_asset_id uuid REFERENCES clip_clash_assets(id), ADD thumbnail_asset_id uuid REFERENCES clip_clash_assets(id),
 ADD clip_start_ms integer, ADD clip_end_ms integer,
 ADD moment_description text, ADD game text, ADD event text,
 ADD featured_members text[] NOT NULL DEFAULT '{}', ADD moment_tags text[] NOT NULL DEFAULT '{}',
 ADD clip_approval_status text NOT NULL DEFAULT 'pending' CHECK(clip_approval_status IN ('pending','approved','rejected')),
 ADD rights_reference text,
 ADD CONSTRAINT clip_time_bounds CHECK((clip_start_ms IS NULL AND clip_end_ms IS NULL) OR (clip_start_ms IS NOT NULL AND clip_end_ms IS NOT NULL AND clip_start_ms>=0 AND clip_end_ms>clip_start_ms));
CREATE FUNCTION clip_clash_valid_weights(w jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb;
BEGIN
 IF jsonb_typeof(w)<>'object' OR w='{}'::jsonb THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(w) LOOP
  IF k !~ '^[a-z][a-z0-9_-]{0,39}$' OR jsonb_typeof(v)<>'number' THEN RETURN false; END IF;
  IF v::text::numeric<0 OR v::text::numeric>1000 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE TABLE clip_clash_prompts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text UNIQUE NOT NULL, title text NOT NULL, description text NOT NULL,
 weights jsonb NOT NULL CHECK(clip_clash_valid_weights(weights)), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO clip_clash_prompts(key,title,description,weights) VALUES
 ('clutch','Clutch','Deliver under pressure.','{"clutch":5,"precision":2,"teamwork":1}'),
 ('comeback','Comeback','Turn a losing moment around.','{"comeback":5,"resilience":3,"clutch":1}'),
 ('reaction','Reaction','Bring the biggest reaction.','{"reaction":5,"surprise":3,"celebration":2}'),
 ('comedy','Comedy','Find the funniest moment.','{"comedy":5,"surprise":2,"reaction":1}'),
 ('collab','Collab','Show creators working together.','{"collab":5,"teamwork":3,"creators":1}');
CREATE TABLE clip_clash_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invite_code text UNIQUE,
 mode text NOT NULL CHECK(mode IN ('pvp','cpu')), status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','active','completed','cancelled','expired')),
 prompt_pool jsonb NOT NULL DEFAULT '[]',
 current_round integer NOT NULL DEFAULT 0 CHECK(current_round BETWEEN 0 AND 5), winner_seat integer CHECK(winner_seat IN (1,2)), draw boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 CHECK((mode='cpu' AND invite_code IS NULL) OR (mode='pvp' AND invite_code IS NOT NULL)), CHECK(NOT(draw AND winner_seat IS NOT NULL))
);
CREATE TABLE clip_clash_players (
 match_id uuid REFERENCES clip_clash_matches(id), seat integer CHECK(seat IN (1,2)), user_id uuid REFERENCES users(id), cpu boolean NOT NULL DEFAULT false,
 score integer NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 3), ready_at timestamptz,
 PRIMARY KEY(match_id,seat), UNIQUE(match_id,user_id), CHECK((cpu AND user_id IS NULL) OR (NOT cpu AND user_id IS NOT NULL))
);
CREATE TABLE clip_clash_cpu_pool(card_id uuid PRIMARY KEY REFERENCES cards(id));
CREATE TABLE clip_clash_lineups (
 match_id uuid NOT NULL, seat integer NOT NULL, slot integer NOT NULL CHECK(slot BETWEEN 1 AND 5), card_id uuid NOT NULL REFERENCES cards(id),
 instance_id uuid REFERENCES card_instances(id), snapshot jsonb NOT NULL,
 PRIMARY KEY(match_id,seat,slot), UNIQUE(match_id,seat,card_id), UNIQUE(match_id,instance_id),
 FOREIGN KEY(match_id,seat) REFERENCES clip_clash_players(match_id,seat)
);
CREATE TABLE clip_clash_rounds (
 match_id uuid REFERENCES clip_clash_matches(id), number integer CHECK(number BETWEEN 1 AND 5), prompt_id uuid NOT NULL REFERENCES clip_clash_prompts(id),
 prompt_snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), winner_seat integer CHECK(winner_seat IN (1,2)),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 PRIMARY KEY(match_id,number), UNIQUE(match_id,prompt_id)
);
CREATE TABLE clip_clash_submissions (
 match_id uuid NOT NULL, round integer NOT NULL, seat integer NOT NULL, card_id uuid NOT NULL, score numeric CHECK(score>=0), explanation jsonb,
 submitted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id,round,seat), UNIQUE(match_id,seat,card_id),
 FOREIGN KEY(match_id,round) REFERENCES clip_clash_rounds(match_id,number),
 FOREIGN KEY(match_id,seat,card_id) REFERENCES clip_clash_lineups(match_id,seat,card_id)
);
ALTER TABLE card_instances ADD locked_by_game_match_id uuid REFERENCES clip_clash_matches(id);
ALTER TABLE card_instances DROP CONSTRAINT card_single_trade_reservation;
ALTER TABLE card_instances ADD CONSTRAINT card_single_reservation CHECK(num_nonnulls(locked_by_trade_id,market_listing_id,market_offer_id,locked_by_game_match_id)<=1);
CREATE INDEX clip_clash_inventory_lock ON card_instances(locked_by_game_match_id) WHERE locked_by_game_match_id IS NOT NULL;
CREATE INDEX clip_clash_user_matches ON clip_clash_players(user_id,match_id);
CREATE INDEX clip_clash_expiry ON clip_clash_matches(expires_at) WHERE status IN ('waiting','active');
CREATE FUNCTION clip_clash_release_locks() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status IN ('completed','cancelled','expired') THEN UPDATE card_instances SET locked_by_game_match_id=NULL WHERE locked_by_game_match_id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clip_clash_close AFTER UPDATE OF status ON clip_clash_matches FOR EACH ROW EXECUTE FUNCTION clip_clash_release_locks();
