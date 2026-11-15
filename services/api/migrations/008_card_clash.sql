-- Artwork-only gameplay. Video metadata remains optional for legacy clients.
ALTER TABLE cards ADD game_enabled boolean NOT NULL DEFAULT false;
-- Curated demo suitability tags; independent of rarity and base_power.
WITH catalog(id,tags,cpu) AS (VALUES
('d0000000-0000-4000-8000-000000001001',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001002',ARRAY['clutch','precision','teamwork']::text[],true),
('d0000000-0000-4000-8000-000000001003',ARRAY['clutch','precision','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001004',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001005',ARRAY['reaction','celebration','creators']::text[],false),
('d0000000-0000-4000-8000-000000001006',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001007',ARRAY['comeback','resilience','teamwork']::text[],true),
('d0000000-0000-4000-8000-000000001008',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001009',ARRAY['comedy','reaction','surprise']::text[],true),
('d0000000-0000-4000-8000-000000001010',ARRAY['reaction','creators','collab']::text[],false),
('d0000000-0000-4000-8000-000000001011',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001012',ARRAY['clutch','precision','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001013',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001014',ARRAY['comedy','reaction','surprise']::text[],false),
('d0000000-0000-4000-8000-000000001015',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001016',ARRAY['reaction','celebration','creators']::text[],true),
('d0000000-0000-4000-8000-000000001017',ARRAY['clutch','precision','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001018',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001019',ARRAY['clutch','precision','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001020',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001021',ARRAY['comeback','resilience','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001022',ARRAY['teamwork','precision']::text[],false),
('d0000000-0000-4000-8000-000000001023',ARRAY['comedy','reaction','surprise']::text[],false),
('d0000000-0000-4000-8000-000000001024',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001025',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001026',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001027',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001028',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001029',ARRAY['reaction','celebration','creators']::text[],false),
('d0000000-0000-4000-8000-000000001030',ARRAY['comeback','resilience','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001031',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001032',ARRAY['collab','creators','teamwork']::text[],true),
('d0000000-0000-4000-8000-000000001033',ARRAY['clutch','precision','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001034',ARRAY['precision','surprise','clutch']::text[],false),
('d0000000-0000-4000-8000-000000001035',ARRAY['collab','creators','teamwork']::text[],false),
('d0000000-0000-4000-8000-000000001036',ARRAY['comedy','reaction','surprise']::text[],false),
('d0000000-0000-4000-8000-000000001037',ARRAY['comedy','reaction','surprise']::text[],false),
('d0000000-0000-4000-8000-000000001038',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001039',ARRAY['comeback','creators','resilience']::text[],false),
('d0000000-0000-4000-8000-000000001040',ARRAY['reaction','celebration','creators']::text[],false)
) UPDATE cards c SET game_enabled=true,moment_tags=catalog.tags FROM catalog WHERE c.id=catalog.id::uuid;
-- Fixed five-card CPU deck: clutch, comeback, reaction, comedy, collab.
INSERT INTO clip_clash_cpu_pool(card_id)
 SELECT id FROM cards WHERE id IN (
'd0000000-0000-4000-8000-000000001002','d0000000-0000-4000-8000-000000001007','d0000000-0000-4000-8000-000000001009','d0000000-0000-4000-8000-000000001016','d0000000-0000-4000-8000-000000001032'
) ON CONFLICT DO NOTHING;
-- Preserve compatibility for previously confirmed video-era lineups.
UPDATE clip_clash_lineups l SET snapshot=l.snapshot||jsonb_build_object('art_url',c.art_url)
 FROM cards c WHERE c.id=l.card_id AND NOT(l.snapshot ? 'art_url');
