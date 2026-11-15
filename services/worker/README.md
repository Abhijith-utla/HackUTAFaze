# Content worker

Run `npm run dev --workspace @faze/worker` with server-only DATABASE_URL for the shared Tiger Cloud database. Remote connections require TLS in the URL. Apply A's migrations first. ENGAGEMENT_SIM_INTERVAL_SECONDS (default 30) controls demo engagement; every recorded event has simulated=true.

The worker holds row locks through each job transaction (FOR UPDATE SKIP LOCKED). Partial job effects roll back to a savepoint on failure; the job is marked failed with an error. A crash rolls the entire uncommitted job back to queued, making restart safe. Engagement event/stat writes are atomic. Publishing jobs validate art URLs, rarity availability and pack odds before publishing; API publishing independently validates synchronously too.

Every cycle scans pending submissions because signup/trade insert pending rows directly. Automatic checks only update auto_flags, never approval status. A small explicit profanity list is a demo baseline, not comprehensive language moderation. Fan art without inline imageData bytes is marked image_unverified for staff review; client MIME/size claims are never trusted. Actual uploaded art is checked by the API upload endpoint.

Run `npm test --workspace @faze/worker` for catalog, moderation, publishing and job rollback tests. Run `node --test services/worker/test/database.test.mjs` with isolated TEST_DATABASE_URL for database-backed job tests. Never target the application database.
