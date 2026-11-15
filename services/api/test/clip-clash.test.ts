import {beforeAll,afterAll,it,expect} from 'vitest';
import {makeApp,signup,makeSetWithPack,pool} from './helpers.js';
import {suitability,greedyCard,matchOutcome,decideRound} from '../src/clip-clash-scoring.js';
let app:Awaited<ReturnType<typeof makeApp>>;
beforeAll(async()=>{app=await makeApp();});
afterAll(async()=>{await app.close();await pool.end();});
const headers=(u:{cookie:string})=>({cookie:u.cookie});
async function fixture(tags=['clutch']) {
 const users=[await signup(app),await signup(app)];
 const {cardIds}=await makeSetWithPack();
 const asset=(await pool.query("INSERT INTO clip_clash_assets(mime,bytes) VALUES('video/mp4',$1) RETURNING id",[Buffer.from('00000018667479706d703432','hex')])).rows[0].id;
 await pool.query("UPDATE cards SET game_enabled=true,clip_asset_id=$2,clip_start_ms=0,clip_end_ms=1000,clip_approval_status='approved',rights_reference='test-fixture',moment_tags=$3 WHERE id=ANY($1::uuid[])",[cardIds,asset,tags]);
 const instances:string[][]=[[],[]];
 for(let seat=0;seat<2;seat++) for(const cardId of cardIds) instances[seat].push((await pool.query('INSERT INTO card_instances(card_id,owner_id,serial) VALUES($1,$2,$3) RETURNING id',[cardId,users[seat].id,seat+1])).rows[0].id);
 return {users,cardIds,instances};
}
async function match(f:Awaited<ReturnType<typeof fixture>>,cpu=false) {
 if(cpu){await pool.query('DELETE FROM clip_clash_cpu_pool');for(const id of f.cardIds)await pool.query('INSERT INTO clip_clash_cpu_pool(card_id) VALUES($1)',[id]);}
 const made=await app.inject({method:'POST',url:'/game/matches',headers:headers(f.users[0]),payload:{mode:cpu?'cpu':'pvp'}});
 expect(made.statusCode,made.body).toBe(200);const s=made.json(),id=s.match.id;
 if(!cpu){const join=await app.inject({method:'POST',url:'/game/join',headers:headers(f.users[1]),payload:{code:s.match.invite_code}});expect(join.statusCode,join.body).toBe(200);}
 return id;
}
const post=(u:{cookie:string},id:string,action:string,payload:any)=>app.inject({method:'POST',url:`/game/matches/${id}/${action}`,headers:headers(u),payload});
it('scores only unique tags and validated prompt weights; greedy CPU and terminal rules',()=>{
 expect(suitability(['clutch','comedy'],{clutch:5,reaction:2}).score).toBe(5);
 expect(()=>suitability(['clutch','clutch'],{clutch:5})).toThrow();
 expect(()=>suitability([],{clutch:-1})).toThrow();
 expect(greedyCard([{card_id:'a',snapshot:{moment_tags:['clutch']}},{card_id:'b',snapshot:{moment_tags:['reaction']}}],{reaction:5}).card_id).toBe('b');
 expect(matchOutcome([3,1],3)).toEqual({complete:true,winner:1,draw:false});
 // Best of five: first to 3 clinches; after round 5 the higher score wins; only equal scores draw.
 expect(matchOutcome([2,1],5)).toEqual({complete:true,winner:1,draw:false});
 expect(matchOutcome([1,2],5)).toEqual({complete:true,winner:2,draw:false});
 expect(matchOutcome([2,2],5)).toEqual({complete:true,winner:null,draw:true});
 expect(matchOutcome([1,1],4)).toEqual({complete:false,winner:null,draw:false});
 expect(matchOutcome([0,3],3)).toEqual({complete:true,winner:2,draw:false});
});
it('rounds: better tag match wins; equal tag scores go to the stronger card; equal on both is no point',()=>{
 expect(decideRound({score:8,power:20},{score:5,power:95})).toEqual({winner:1,tiebreak:false});
 expect(decideRound({score:3,power:20},{score:7,power:20})).toEqual({winner:2,tiebreak:false});
 expect(decideRound({score:8,power:45},{score:8,power:95})).toEqual({winner:2,tiebreak:true});
 expect(decideRound({score:8,power:95},{score:8,power:45})).toEqual({winner:1,tiebreak:true});
 expect(decideRound({score:8,power:70},{score:8,power:70})).toEqual({winner:null,tiebreak:false});
});
it('keeps old cards pending, validates migration weights and interval bounds',async()=>{
 const {cardIds}=await makeSetWithPack();expect((await pool.query('SELECT clip_approval_status FROM cards WHERE id=$1',[cardIds[0]])).rows[0].clip_approval_status).toBe('pending');
 await expect(pool.query("UPDATE cards SET clip_start_ms=5,clip_end_ms=2 WHERE id=$1",[cardIds[0]])).rejects.toMatchObject({code:'23514'});
 await expect(pool.query("INSERT INTO clip_clash_prompts(key,title,description,weights) VALUES('bad','bad','bad','{\"bad\":-1}')")).rejects.toMatchObject({code:'23514'});
});
it('validates lineup ownership, distinct moments, locks against trading and listings; cancel releases',async()=>{
 const f=await fixture(),id=await match(f);
 expect((await post(f.users[0],id,'lineup',{instanceIds:[f.instances[0][0],...f.instances[0].slice(0,4)]})).statusCode).toBe(400);
 expect((await post(f.users[0],id,'lineup',{instanceIds:f.instances[1]})).statusCode).toBe(400);
 expect((await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]})).statusCode).toBe(200);
 const listing=await app.inject({method:'POST',url:'/marketplace/listings',headers:headers(f.users[0]),payload:{instanceId:f.instances[0][0]}});expect(listing.statusCode).toBe(409);
 const trade=await app.inject({method:'POST',url:'/trades',headers:headers(f.users[0]),payload:{toUserId:f.users[1].id,offeredInstanceIds:[f.instances[0][0]],requestedInstanceIds:[f.instances[1][0]]}});expect(trade.statusCode).toBe(409);
 await post(f.users[0],id,'cancel',{});
 expect((await pool.query('SELECT count(*)::int n FROM card_instances WHERE locked_by_game_match_id=$1',[id])).rows[0].n).toBe(0);
});
it('hides submissions, resumes on GET, rejects duplicates, persists five-round ties and unlocks',async()=>{
 const f=await fixture(),id=await match(f);
 for(let i=0;i<2;i++)expect((await post(f.users[i],id,'lineup',{instanceIds:f.instances[i]})).statusCode).toBe(200);
 for(let round=1;round<=5;round++) {
  const first=await post(f.users[0],id,'submit',{cardId:f.cardIds[round-1],round});expect(first.statusCode,first.body).toBe(200);
  const hidden=await app.inject({method:'GET',url:`/game/matches/${id}`,headers:headers(f.users[1])});expect(hidden.json().rounds[round-1].submissions).toHaveLength(0);
  expect((await post(f.users[0],id,'submit',{cardId:f.cardIds[round-1],round})).statusCode).toBe(409);
  const result=await post(f.users[1],id,'submit',{cardId:f.cardIds[round-1],round});expect(result.statusCode,result.body).toBe(200);
  expect(result.json().rounds[round-1].winner_seat).toBeNull();
  if(round===5){expect(result.json().match.status).toBe('completed');expect(result.json().match.draw).toBe(true);}
 }
 expect((await pool.query('SELECT count(*)::int n FROM card_instances WHERE locked_by_game_match_id=$1',[id])).rows[0].n).toBe(0);
 expect((await pool.query('SELECT count(DISTINCT prompt_id)::int n FROM clip_clash_rounds WHERE match_id=$1',[id])).rows[0].n).toBe(5);
});
it('CPU lineup is visible before play, uses current prompt greedily, snapshots survive edits',async()=>{
 const f=await fixture(),id=await match(f,true);
 const before=await app.inject({method:'GET',url:`/game/matches/${id}`,headers:headers(f.users[0])});expect(before.json().lineups.filter((l:any)=>l.seat===2)).toHaveLength(5);
 await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]});
 await pool.query("UPDATE cards SET moment_tags='{}' WHERE id=ANY($1::uuid[])",[f.cardIds]);
 const result=await post(f.users[0],id,'submit',{cardId:f.cardIds[0],round:1});expect(result.statusCode,result.body).toBe(200);
 const s=result.json();expect(s.rounds[0].submissions).toHaveLength(2);
 const expected=greedyCard(s.lineups.filter((l:any)=>l.seat===2),s.rounds[0].prompt_snapshot.weights);expect(s.rounds[0].submissions.find((x:any)=>x.seat===2).card_id).toBe(expected.card_id);
 await post(f.users[0],id,'cancel',{});
});
it('three wins ends early; expiration releases lineup locks',async()=>{
 const f=await fixture(['clutch','comeback','reaction','comedy','collab']),id=await match(f);
 // Give seat 2 different empty-tag cards so seat 1 wins every prompt.
 const other=await makeSetWithPack();const asset=(await pool.query('SELECT clip_asset_id FROM cards WHERE id=$1',[f.cardIds[0]])).rows[0].clip_asset_id;
 await pool.query("UPDATE cards SET game_enabled=true,clip_asset_id=$2,clip_start_ms=0,clip_end_ms=1000,clip_approval_status='approved',rights_reference='test',moment_tags=ARRAY['unmatched'] WHERE id=ANY($1::uuid[])",[other.cardIds,asset]);
 const ids=[];for(const cid of other.cardIds)ids.push((await pool.query('INSERT INTO card_instances(card_id,owner_id,serial) VALUES($1,$2,1) RETURNING id',[cid,f.users[1].id])).rows[0].id);
 await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]});await post(f.users[1],id,'lineup',{instanceIds:ids});
 for(let round=1;round<=3;round++){await post(f.users[0],id,'submit',{cardId:f.cardIds[round-1],round});const r=await post(f.users[1],id,'submit',{cardId:other.cardIds[round-1],round});expect(r.statusCode,r.body).toBe(200);if(round===3){expect(r.json().match.winner_seat).toBe(1);expect(r.json().match.status).toBe('completed');}}
 const id2=await match(f);await post(f.users[0],id2,'lineup',{instanceIds:f.instances[0]});await pool.query("UPDATE clip_clash_matches SET expires_at=now()-interval '1 second' WHERE id=$1",[id2]);
 const expired=await app.inject({method:'GET',url:`/game/matches/${id2}`,headers:headers(f.users[0])});expect(expired.json().match.status).toBe('expired');expect((await pool.query('SELECT count(*)::int n FROM card_instances WHERE locked_by_game_match_id=$1',[id2])).rows[0].n).toBe(0);
});
it('rejects duplicate owned moments, ineligible clips and existing listing reservations',async()=>{
 const f=await fixture(),id=await match(f);
 const duplicate=(await pool.query('INSERT INTO card_instances(card_id,owner_id,serial) VALUES($1,$2,3) RETURNING id',[f.cardIds[0],f.users[0].id])).rows[0].id;
 expect((await post(f.users[0],id,'lineup',{instanceIds:[...f.instances[0].slice(0,4),duplicate]})).statusCode).toBe(400);
 await pool.query("UPDATE cards SET game_enabled=false WHERE id=$1",[f.cardIds[0]]);
 expect((await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]})).statusCode).toBe(400);
 await pool.query("UPDATE cards SET game_enabled=true WHERE id=$1",[f.cardIds[0]]);
 const listed=await app.inject({method:'POST',url:'/marketplace/listings',headers:headers(f.users[0]),payload:{instanceId:f.instances[0][0]}});expect(listed.statusCode).toBe(201);
 expect((await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]})).statusCode).toBe(409);
 await post(f.users[0],id,'cancel',{});
});
it('serializes simultaneous submissions and rejects reused cards in the following round',async()=>{
 const f=await fixture(),id=await match(f);
 for(let i=0;i<2;i++)await post(f.users[i],id,'lineup',{instanceIds:f.instances[i]});
 const results=await Promise.all(f.users.map(u=>post(u,id,'submit',{cardId:f.cardIds[0],round:1})));expect(results.map(r=>r.statusCode)).toEqual([200,200]);
 const resumed=await app.inject({method:'GET',url:`/game/matches/${id}`,headers:headers(f.users[0])});expect(resumed.json().match.current_round).toBe(2);
 expect((await post(f.users[0],id,'submit',{cardId:f.cardIds[0],round:2})).statusCode).toBe(409);
 await post(f.users[0],id,'cancel',{});
});
it('protects private matches and serves approved assets with byte ranges',async()=>{
 const f=await fixture(),id=await match(f),outsider=await signup(app);
 const denied=await app.inject({method:'GET',url:`/game/matches/${id}`,headers:headers(outsider)});expect(denied.statusCode).toBe(403);
 const asset=(await pool.query('SELECT clip_asset_id FROM cards WHERE id=$1',[f.cardIds[0]])).rows[0].clip_asset_id;
 const anonymous=await app.inject({method:'GET',url:`/game/assets/${asset}`});expect(anonymous.statusCode).toBe(401);
 const partial=await app.inject({method:'GET',url:`/game/assets/${asset}`,headers:{...headers(f.users[0]),range:'bytes=0-3'}});expect(partial.statusCode).toBe(206);expect(partial.rawPayload.length).toBe(4);expect(partial.headers['accept-ranges']).toBe('bytes');
 const invalid=await app.inject({method:'GET',url:`/game/assets/${asset}`,headers:{...headers(f.users[0]),range:'bytes=99999-'}});expect(invalid.statusCode).toBe(416);
 await post(f.users[0],id,'cancel',{});
});
it('freezes future prompts before play without exposing them in state',async()=>{
 const f=await fixture(),id=await match(f),original=(await pool.query('SELECT id,weights FROM clip_clash_prompts')).rows;
 try {
  await pool.query(`UPDATE clip_clash_prompts SET weights='{"edited":1}'`);
  await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]});
  const s=(await post(f.users[1],id,'lineup',{instanceIds:f.instances[1]})).json();
  expect(s.match.prompt_pool).toBeUndefined();expect(s.rounds[0].prompt_snapshot.weights.edited).toBeUndefined();
 }finally{for(const p of original)await pool.query('UPDATE clip_clash_prompts SET weights=$2 WHERE id=$1',[p.id,p.weights]);await post(f.users[0],id,'cancel',{});}
});
it('plays artwork-only CPU matches without any video or clip approval',async()=>{
 const f=await fixture(['clutch','precision']);
 await pool.query("UPDATE cards SET clip_asset_id=NULL,clip_start_ms=NULL,clip_end_ms=NULL,clip_approval_status='pending',rights_reference=NULL WHERE id=ANY($1::uuid[])",[f.cardIds]);
 const id=await match(f,true);
 const locked=await post(f.users[0],id,'lineup',{instanceIds:f.instances[0]});expect(locked.statusCode,locked.body).toBe(200);
 expect(locked.json().lineups.every((l:any)=>l.snapshot.art_url&&l.snapshot.clip_asset_id===null)).toBe(true);
 const result=await post(f.users[0],id,'submit',{cardId:f.cardIds[0],round:1});expect(result.statusCode,result.body).toBe(200);expect(result.json().rounds[0].status).toBe('resolved');
 await post(f.users[0],id,'cancel',{});
});
it('repairs an already-applied legacy schema without changing played prompts or scores',async()=>{
 const f=await fixture(),id=await match(f);
 for(let i=0;i<2;i++)await post(f.users[i],id,'lineup',{instanceIds:f.instances[i]});
 const db=await pool.connect();
 try {
  const {readFile}=await import('node:fs/promises');
  const sql=await readFile(new URL('../migrations/012_clip_clash_prompt_pool.sql',import.meta.url),'utf8');
  await db.query('BEGIN');
  const before=(await db.query('SELECT prompt_id,prompt_snapshot FROM clip_clash_rounds WHERE match_id=$1',[id])).rows[0];
  await db.query('ALTER TABLE clip_clash_matches DROP COLUMN prompt_pool');
  await db.query(sql);
  const repaired=(await db.query('SELECT prompt_pool,current_round FROM clip_clash_matches WHERE id=$1',[id])).rows[0];
  expect(repaired.prompt_pool).toHaveLength(5);expect(repaired.current_round).toBe(1);
  expect(repaired.prompt_pool.find((p:any)=>p.id===before.prompt_id).weights).toEqual(before.prompt_snapshot.weights);
  await db.query(sql);
  expect((await db.query('SELECT prompt_pool FROM clip_clash_matches WHERE id=$1',[id])).rows[0].prompt_pool).toEqual(repaired.prompt_pool);
 }finally{await db.query('ROLLBACK');db.release();await post(f.users[0],id,'cancel',{});}
});
