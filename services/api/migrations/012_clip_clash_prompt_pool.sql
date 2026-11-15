-- Forward repair for databases where the original Clip Clash migration was
-- already recorded before prompt_pool was added to the application contract.
ALTER TABLE clip_clash_matches
 ADD COLUMN IF NOT EXISTS prompt_pool jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Keep previously played prompts exactly as snapshotted. Fill the remaining
-- slots from current active prompts without duplicates. Do not change scores,
-- submissions, ownership, reservations, or the current round.
UPDATE clip_clash_matches m
 SET prompt_pool = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id', p.id, 'title', p.title, 'description', p.description, 'weights', p.weights
  ) ORDER BY p.priority, p.round_number, p.id), '[]'::jsonb)
  FROM (
   SELECT candidates.* FROM (
    SELECT r.prompt_id AS id,
     r.prompt_snapshot->>'title' AS title,
     r.prompt_snapshot->>'description' AS description,
     r.prompt_snapshot->'weights' AS weights,
     0 AS priority, r.number AS round_number
    FROM clip_clash_rounds r WHERE r.match_id=m.id
    UNION ALL
    SELECT prompt.id, prompt.title, prompt.description, prompt.weights,
     1 AS priority, 0 AS round_number
    FROM clip_clash_prompts prompt
    WHERE prompt.active AND NOT EXISTS (
     SELECT 1 FROM clip_clash_rounds r
     WHERE r.match_id=m.id AND r.prompt_id=prompt.id
    )
   ) candidates
   ORDER BY candidates.priority, candidates.round_number, candidates.id
   LIMIT 5
  ) p
 )
 WHERE m.prompt_pool='[]'::jsonb;
