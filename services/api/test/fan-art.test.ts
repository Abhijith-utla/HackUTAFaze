import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signup, pool } from './helpers.js';
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
});
