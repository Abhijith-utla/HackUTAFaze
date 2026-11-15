import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeAdmin, makeApp, signup, pool } from './helpers.js';
let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await pool.end(); });
it('fan art is authenticated, held pending, and queued for moderation without a public art URL', async () => {
 const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);
 const payload={name:'Demo fan art',mimeType:'image/png',base64:bytes.toString('base64')};
 expect((await app.inject({method:'POST',url:'/submissions/fan-art',payload})).statusCode).toBe(401);
 const fan=await signup(app);
 const result=await app.inject({method:'POST',url:'/submissions/fan-art',headers:{cookie:fan.cookie},payload});
 expect(result.statusCode).toBe(201);const submission=result.json().submission;
 expect(submission.status).toBe('pending');expect(submission.userId).toBe(fan.id);expect(submission.payload.artUrl).toBeUndefined();
 const jobs=await pool.query("SELECT * FROM jobs WHERE kind='moderate' AND payload->>'submissionId'=$1",[submission.id]);expect(jobs.rowCount).toBe(1);
 expect((await app.inject({method:'GET',url:`/uploaded-art/${submission.id}.png`})).statusCode).toBe(404);
 expect((await app.inject({method:'POST',url:'/submissions/fan-art',headers:{cookie:fan.cookie},payload:{...payload,mimeType:'image/jpeg'}})).statusCode).toBe(400);
 const artId=submission.payload.artId;expect(artId).toMatch(/^[0-9a-f-]{36}$/);
 const stored=await pool.query('SELECT mime,demo FROM card_art WHERE id=$1',[artId]);expect(stored.rows[0]).toMatchObject({mime:'image/png',demo:false});
 expect((await app.inject(`/art/${artId}.png`)).statusCode).toBe(404); // private while pending
 const admin=await makeAdmin();
 // Identical bytes uploaded by an admin must not reuse (and thereby publish or hide) the fan's private row.
 const up=await app.inject({method:'POST',url:'/admin/art',headers:{cookie:admin.cookie},payload:{base64:payload.base64,mimeType:'image/png'}});
 expect(up.statusCode).toBe(201);expect(up.json().artUrl).not.toContain(artId);
 expect((await app.inject(up.json().artUrl)).statusCode).toBe(200);
 expect((await app.inject(`/art/${artId}.png`)).statusCode).toBe(404);
 const ok=await app.inject({method:'POST',url:`/admin/moderation/${submission.id}`,headers:{cookie:admin.cookie},payload:{decision:'approve'}});expect(ok.statusCode).toBe(200);
 expect((await app.inject(`/art/${artId}.png`)).statusCode).toBe(200); // public once approved
});
