import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { fail } from '../errors.js';
import { MomentTags, suitability, greedyCard, matchOutcome } from '../clip-clash-scoring.js';
const Id=z.object({id:z.string().uuid()});
const eligible=`c.game_enabled AND cardinality(c.moment_tags)>0 AND length(trim(c.art_url))>0`;
const snapshot=(c:any)=>({id:c.id,name:c.name,art_url:c.art_url,moment_tags:MomentTags.parse(c.moment_tags),clip_asset_id:c.clip_asset_id,thumbnail_asset_id:c.thumbnail_asset_id,clip_start_ms:c.clip_start_ms,clip_end_ms:c.clip_end_ms,moment_description:c.moment_description});
async function expire() { await pool.query("UPDATE clip_clash_matches SET status='expired',closed_at=now() WHERE status IN ('waiting','active') AND expires_at<now()"); }
async function lock(c:pg.PoolClient,id:string,user:string) {
 const m=(await c.query('SELECT * FROM clip_clash_matches WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!m) fail('NOT_FOUND','Match not found');
 const player=(await c.query('SELECT * FROM clip_clash_players WHERE match_id=$1 AND user_id=$2',[id,user])).rows[0];
 if(!player) fail('FORBIDDEN','Not your match');
 if(new Date(m.expires_at).getTime()<=Date.now() && ['waiting','active'].includes(m.status)) fail('CONFLICT','Match expired');
 return {m,player};
}
async function nextRound(c:pg.PoolClient,id:string,number:number) {
 const prompt=(await c.query("SELECT p.* FROM clip_clash_matches m CROSS JOIN LATERAL jsonb_to_recordset(m.prompt_pool) AS p(id uuid,title text,description text,weights jsonb) WHERE m.id=$1 AND NOT EXISTS(SELECT 1 FROM clip_clash_rounds r WHERE r.match_id=m.id AND r.prompt_id=p.id) ORDER BY random() LIMIT 1",[id])).rows[0];
 if(!prompt) fail('CONFLICT','Not enough active prompts');
 await c.query('INSERT INTO clip_clash_rounds(match_id,number,prompt_id,prompt_snapshot) VALUES($1,$2,$3,$4)',[id,number,prompt.id,{title:prompt.title,description:prompt.description,weights:prompt.weights}]);
 await c.query("UPDATE clip_clash_matches SET current_round=$2,status='active',updated_at=now() WHERE id=$1",[id,number]);
}
async function state(c:pg.PoolClient,id:string,user:string) {
 const {m,player}=await lock(c,id,user);
 const players=(await c.query('SELECT seat,cpu,score,ready_at FROM clip_clash_players WHERE match_id=$1 ORDER BY seat',[id])).rows;
 const lineups=(await c.query('SELECT seat,slot,card_id,snapshot FROM clip_clash_lineups WHERE match_id=$1 ORDER BY seat,slot',[id])).rows;
 const rounds=(await c.query('SELECT * FROM clip_clash_rounds WHERE match_id=$1 ORDER BY number',[id])).rows;
 const submissions=(await c.query('SELECT * FROM clip_clash_submissions WHERE match_id=$1 ORDER BY round,seat',[id])).rows.map(s=>({...s,score:s.score===null?null:Number(s.score)}));
 const {prompt_pool: _privatePrompts,...publicMatch}=m;
 return {match:publicMatch,seat:player.seat,players,lineups,rounds:rounds.map(r=>({...r,submissions:submissions.filter(s=>s.round===r.number && (r.status==='resolved'||s.seat===player.seat))}))};
}
export async function clipClashRoutes(app:FastifyInstance) {
 let expiryTimer: ReturnType<typeof setInterval>;
 app.addHook('onReady',async()=>{await expire();expiryTimer=setInterval(()=>{expire().catch(e=>app.log.error(e,'Game expiry failed'));},60000);expiryTimer.unref();});
 app.addHook('onClose',async()=>{clearInterval(expiryTimer);});
 // Lazy expiry runs on all game traffic; terminal-state trigger always releases reservations.
 app.addHook('preHandler',async req=>{if(req.url.startsWith('/game/')) { requireUser(req); await expire(); }});
 app.get('/game/cards',async req=>{
  const u=requireUser(req);
  const rows=(await pool.query(`SELECT c.*,i.id instance_id,i.serial FROM cards c JOIN card_instances i ON i.card_id=c.id WHERE i.owner_id=$1 AND ${eligible} AND num_nonnulls(i.locked_by_trade_id,i.market_listing_id,i.market_offer_id,i.locked_by_game_match_id)=0 ORDER BY c.name,i.serial`,[u.sub])).rows;
  return {cards:rows.map(c=>({...snapshot(c),instance_id:c.instance_id,serial:c.serial})),cpuAvailable:(await pool.query(`SELECT count(*)::int n FROM clip_clash_cpu_pool p JOIN cards c ON c.id=p.card_id WHERE ${eligible}`)).rows[0].n>=5};
 });
 app.get('/game/matches',async req=>({matches:(await pool.query('SELECT m.id,m.invite_code,m.mode,m.status,m.current_round,m.winner_seat,m.draw,m.created_at,m.closed_at FROM clip_clash_matches m JOIN clip_clash_players p ON p.match_id=m.id WHERE p.user_id=$1 ORDER BY m.created_at DESC LIMIT 30',[requireUser(req).sub])).rows}));
 app.post('/game/matches',async req=>{
  const u=requireUser(req),{mode}=z.object({mode:z.enum(['cpu','pvp'])}).strict().parse(req.body);
  return tx(async c=>{
   if((await c.query('SELECT count(*)::int n FROM clip_clash_prompts WHERE active')).rows[0].n<5) fail('CONFLICT','Five active prompts are required');
   const m=(await c.query('INSERT INTO clip_clash_matches(mode,invite_code,prompt_pool) VALUES($1,$2,(SELECT jsonb_agg(p) FROM (SELECT id,title,description,weights FROM clip_clash_prompts WHERE active ORDER BY random() LIMIT 5) p)) RETURNING *',[mode,mode==='pvp'?randomBytes(8).toString('hex').toUpperCase():null])).rows[0];
   await c.query('INSERT INTO clip_clash_players(match_id,seat,user_id) VALUES($1,1,$2)',[m.id,u.sub]);
   if(mode==='cpu') {
    const cards=(await c.query(`SELECT c.* FROM clip_clash_cpu_pool p JOIN cards c ON c.id=p.card_id WHERE ${eligible} ORDER BY c.id LIMIT 5 FOR SHARE OF c`)).rows;
    if(cards.length!==5) fail('CONFLICT','CPU needs five tagged cards in its fixed pool');
    await c.query('INSERT INTO clip_clash_players(match_id,seat,cpu,ready_at) VALUES($1,2,true,now())',[m.id]);
    for(const [i,card] of cards.entries()) await c.query('INSERT INTO clip_clash_lineups(match_id,seat,slot,card_id,snapshot) VALUES($1,2,$2,$3,$4)',[m.id,i+1,card.id,snapshot(card)]);
   }
   return state(c,m.id,u.sub);
  });
 });
 app.post('/game/join',async req=>{
  const u=requireUser(req),{code}=z.object({code:z.string().regex(/^[A-Fa-f0-9]{16}$/)}).strict().parse(req.body);
  return tx(async c=>{
   const m=(await c.query("SELECT * FROM clip_clash_matches WHERE invite_code=$1 AND mode='pvp' FOR UPDATE",[code.toUpperCase()])).rows[0];
   if(!m||m.status!=='waiting'||new Date(m.expires_at).getTime()<Date.now()) fail('CONFLICT','Invite unavailable');
   const players=(await c.query('SELECT * FROM clip_clash_players WHERE match_id=$1',[m.id])).rows;
   if(players.some(p=>p.user_id===u.sub)) return state(c,m.id,u.sub);
   if(players.length!==1) fail('CONFLICT','Match is full');
   await c.query('INSERT INTO clip_clash_players(match_id,seat,user_id) VALUES($1,2,$2)',[m.id,u.sub]);
   return state(c,m.id,u.sub);
  });
 });
 app.get('/game/matches/:id',async req=>tx(c=>state(c,Id.parse(req.params).id,requireUser(req).sub)));
 app.post('/game/matches/:id/lineup',async req=>{
  const u=requireUser(req),{id}=Id.parse(req.params),b=z.object({instanceIds:z.array(z.string().uuid()).length(5)}).strict().parse(req.body);
  if(new Set(b.instanceIds).size!==5) fail('VALIDATION','Select five distinct instances');
  return tx(async c=>{
   const {m,player}=await lock(c,id,u.sub);
   if(m.status!=='waiting'||player.ready_at) fail('CONFLICT','Lineup already locked or match closed');
   const instances=(await c.query('SELECT * FROM card_instances WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[b.instanceIds])).rows;
   if(instances.length!==5||instances.some(i=>i.owner_id!==u.sub)) fail('VALIDATION','Select five owned cards');
   if(instances.some(i=>i.locked_by_trade_id||i.market_listing_id||i.market_offer_id||i.locked_by_game_match_id)) fail('CARD_LOCKED','A selected card is already reserved');
   if(new Set(instances.map(i=>i.card_id)).size!==5) fail('VALIDATION','Each moment may appear only once');
   const cards=(await c.query(`SELECT c.* FROM cards c WHERE c.id=ANY($1::uuid[]) AND ${eligible} ORDER BY c.id FOR SHARE`,[instances.map(i=>i.card_id)])).rows;
   if(cards.length!==5) fail('VALIDATION','All cards need enabled gameplay, artwork and tags');
   for(const [n,i] of instances.entries()) await c.query('INSERT INTO clip_clash_lineups(match_id,seat,slot,card_id,instance_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[id,player.seat,n+1,i.card_id,i.id,snapshot(cards.find(x=>x.id===i.card_id))]);
   await c.query('UPDATE card_instances SET locked_by_game_match_id=$1 WHERE id=ANY($2::uuid[])',[id,b.instanceIds]);
   await c.query('UPDATE clip_clash_players SET ready_at=now() WHERE match_id=$1 AND seat=$2',[id,player.seat]);
   if((await c.query('SELECT count(*)::int n FROM clip_clash_players WHERE match_id=$1 AND ready_at IS NOT NULL',[id])).rows[0].n===2) await nextRound(c,id,1);
   return state(c,id,u.sub);
  });
 });
 app.post('/game/matches/:id/submit',async req=>{
  const u=requireUser(req),{id}=Id.parse(req.params),b=z.object({cardId:z.string().uuid(),round:z.number().int().min(1).max(5)}).strict().parse(req.body);
  return tx(async c=>{
   const {m,player}=await lock(c,id,u.sub);
   if(m.status!=='active'||m.current_round!==b.round) fail('CONFLICT','Round is not open');
   const lineup=(await c.query('SELECT * FROM clip_clash_lineups WHERE match_id=$1',[id])).rows;
   const card=lineup.find(l=>l.seat===player.seat&&l.card_id===b.cardId);
   if(!card) fail('VALIDATION','Card is not in your lineup');
   const used=(await c.query('SELECT * FROM clip_clash_submissions WHERE match_id=$1',[id])).rows;
   if(used.some(s=>s.seat===player.seat&&(s.card_id===b.cardId||s.round===b.round))) fail('CONFLICT','Card or round already submitted');
   const round=(await c.query('SELECT * FROM clip_clash_rounds WHERE match_id=$1 AND number=$2',[id,b.round])).rows[0];
   await c.query('INSERT INTO clip_clash_submissions(match_id,round,seat,card_id) VALUES($1,$2,$3,$4)',[id,b.round,player.seat,b.cardId]);
   if(m.mode==='cpu') {
    // Chooses solely from the current prompt and its own unused lineup.
    const cpu=greedyCard(lineup.filter(l=>l.seat===2&&!used.some(s=>s.seat===2&&s.card_id===l.card_id)),round.prompt_snapshot.weights);
    await c.query('INSERT INTO clip_clash_submissions(match_id,round,seat,card_id) VALUES($1,$2,2,$3)',[id,b.round,cpu.card_id]);
   }
   const submitted=(await c.query('SELECT * FROM clip_clash_submissions WHERE match_id=$1 AND round=$2 ORDER BY seat',[id,b.round])).rows;
   if(submitted.length===2) {
    const results=submitted.map(s=>suitability(lineup.find(l=>l.seat===s.seat&&l.card_id===s.card_id).snapshot.moment_tags,round.prompt_snapshot.weights));
    for(const [n,s] of submitted.entries()) await c.query('UPDATE clip_clash_submissions SET score=$4,explanation=$5 WHERE match_id=$1 AND round=$2 AND seat=$3',[id,b.round,s.seat,results[n].score,JSON.stringify(results[n].matches)]);
    const winner=results[0].score===results[1].score?null:results[0].score>results[1].score?1:2;
    await c.query("UPDATE clip_clash_rounds SET status='resolved',winner_seat=$3,resolved_at=now() WHERE match_id=$1 AND number=$2",[id,b.round,winner]);
    if(winner) await c.query('UPDATE clip_clash_players SET score=score+1 WHERE match_id=$1 AND seat=$2',[id,winner]);
    const scores=(await c.query('SELECT score FROM clip_clash_players WHERE match_id=$1 ORDER BY seat',[id])).rows.map(p=>p.score);
    const outcome=matchOutcome(scores,b.round);
    if(outcome.complete) await c.query("UPDATE clip_clash_matches SET status='completed',winner_seat=$2,draw=$3,closed_at=now(),updated_at=now() WHERE id=$1",[id,outcome.winner,outcome.draw]);
    else await nextRound(c,id,b.round+1);
   }
   return state(c,id,u.sub);
  });
 });
 app.post('/game/matches/:id/cancel',async req=>tx(async c=>{
  const id=Id.parse(req.params).id,u=requireUser(req); const {m}=await lock(c,id,u.sub);
  if(['waiting','active'].includes(m.status)) await c.query("UPDATE clip_clash_matches SET status='cancelled',closed_at=now(),updated_at=now() WHERE id=$1",[id]);
  return state(c,id,u.sub);
 }));
 app.patch('/admin/game/cards/:id/gameplay',async req=>{
  requireAdmin(req);const id=Id.parse(req.params).id;
  const b=z.object({enabled:z.boolean(),tags:MomentTags.refine(t=>t.length>0),cpuPool:z.boolean().default(false)}).strict().parse(req.body);
  return tx(async c=>{
   const result=await c.query('UPDATE cards SET game_enabled=$2,moment_tags=$3 WHERE id=$1 RETURNING id',[id,b.enabled,b.tags]);
   if(!result.rowCount)fail('NOT_FOUND','Card not found');
   await c.query('DELETE FROM clip_clash_cpu_pool WHERE card_id=$1',[id]);
   if(b.cpuPool&&b.enabled)await c.query('INSERT INTO clip_clash_cpu_pool(card_id) VALUES($1)',[id]);
   return {ok:true};
  });
 });
 // Assets are immutable: match snapshots remain valid even if card metadata changes later.
 app.post('/admin/game/assets',{bodyLimit:29*1024*1024},async req=>{
  requireAdmin(req);const b=z.object({mime:z.enum(['video/mp4','video/webm','image/png','image/jpeg']),base64:z.string().max(28*1024*1024)}).strict().parse(req.body);
  const bytes=Buffer.from(b.base64,'base64');
  if(!bytes.length||bytes.length>20*1024*1024||bytes.toString('base64')!==b.base64) fail('VALIDATION','Invalid asset');
  const valid=b.mime==='video/mp4'?bytes.toString('ascii',4,8)==='ftyp':b.mime==='video/webm'?bytes.subarray(0,4).toString('hex')==='1a45dfa3':b.mime==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':bytes.subarray(0,3).toString('hex')==='ffd8ff';
  if(!valid) fail('VALIDATION','Asset type mismatch');
  return {assetId:(await pool.query('INSERT INTO clip_clash_assets(mime,bytes) VALUES($1,$2) RETURNING id',[b.mime,bytes])).rows[0].id};
 });
 app.put('/admin/game/cards/:id',async req=>{
  requireAdmin(req);const id=Id.parse(req.params).id;
  const b=z.object({clipAssetId:z.string().uuid(),thumbnailAssetId:z.string().uuid().nullable().default(null),startMs:z.number().int().nonnegative(),endMs:z.number().int().positive(),tags:MomentTags,rightsReference:z.string().trim().min(1).max(500),description:z.string().max(1000),game:z.string().max(200).nullable().default(null),event:z.string().max(200).nullable().default(null),featuredMembers:z.array(z.string().max(100)).max(30).default([]),approval:z.enum(['pending','approved','rejected']),cpuPool:z.boolean().default(false)}).strict().refine(b=>b.endMs>b.startMs).parse(req.body);
  return tx(async c=>{
   const assets=(await c.query('SELECT id,mime FROM clip_clash_assets WHERE id=ANY($1::uuid[])',[[b.clipAssetId,b.thumbnailAssetId].filter(Boolean)])).rows;
   if(!assets.some(a=>a.id===b.clipAssetId&&a.mime.startsWith('video/'))||b.thumbnailAssetId&&!assets.some(a=>a.id===b.thumbnailAssetId&&a.mime.startsWith('image/'))) fail('VALIDATION','Invalid clip or thumbnail asset');
   const result=await c.query('UPDATE cards SET clip_asset_id=$2,thumbnail_asset_id=$3,clip_start_ms=$4,clip_end_ms=$5,moment_tags=$6,rights_reference=$7,moment_description=$8,clip_approval_status=$9,game=$10,event=$11,featured_members=$12 WHERE id=$1 RETURNING id',[id,b.clipAssetId,b.thumbnailAssetId,b.startMs,b.endMs,b.tags,b.rightsReference,b.description,b.approval,b.game,b.event,b.featuredMembers]);
   if(!result.rowCount) fail('NOT_FOUND','Card not found');
   await c.query('DELETE FROM clip_clash_cpu_pool WHERE card_id=$1',[id]);
   if(b.cpuPool&&b.approval==='approved') await c.query('INSERT INTO clip_clash_cpu_pool(card_id) VALUES($1)',[id]);
   return {ok:true};
  });
 });
 app.get('/game/assets/:id',async(req,reply)=>{
  const u=requireUser(req),id=Id.parse(req.params).id;
  const a=(await pool.query(`SELECT a.* FROM clip_clash_assets a WHERE a.id=$1 AND (EXISTS(SELECT 1 FROM cards c WHERE c.clip_approval_status='approved' AND (c.clip_asset_id=a.id OR c.thumbnail_asset_id=a.id)) OR EXISTS(SELECT 1 FROM clip_clash_lineups l JOIN clip_clash_players p ON p.match_id=l.match_id WHERE p.user_id=$2 AND (l.snapshot->>'clip_asset_id'=a.id::text OR l.snapshot->>'thumbnail_asset_id'=a.id::text)))`,[id,u.sub])).rows[0];
  if(!a) fail('NOT_FOUND','Approved asset not found');
  reply.type(a.mime).header('Cache-Control','private, max-age=3600').header('X-Content-Type-Options','nosniff').header('Accept-Ranges','bytes');
  const range=req.headers.range;
  if(range) {
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(!match||(!match[1]&&!match[2])) return reply.code(416).header('Content-Range',`bytes */${a.bytes.length}`).send();
   const start=match[1]?Number(match[1]):Math.max(0,a.bytes.length-Number(match[2]));
   const end=match[1]&&match[2]?Math.min(Number(match[2]),a.bytes.length-1):a.bytes.length-1;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=a.bytes.length) return reply.code(416).header('Content-Range',`bytes */${a.bytes.length}`).send();
   return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${a.bytes.length}`).send(a.bytes.subarray(start,end+1));
  }
  return reply.send(a.bytes);
 });
}
