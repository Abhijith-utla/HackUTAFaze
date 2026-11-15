# Core API

Use Node 20+. Install repository dependencies, then configure server-only DATABASE_URL, JWT_SECRET and INTERNAL_SECRET in the root .env. Remote Tiger Cloud PostgreSQL URLs must include sslmode=require (or verify-ca/verify-full); the API uses a bounded connection pool. Credentials are never returned to clients.

Run `npm run migrate --workspace @faze/api`, `npm run seed --workspace @faze/api`, then `npm run dev --workspace @faze/api`. The seed is labelled demo and idempotent; never point it at production data.

Tests require a dedicated TEST_DATABASE_URL and reject the same host/port/database as DATABASE_URL. Use an isolated Tiger Cloud test service/database; local PostgreSQL is supported as a compatibility fixture. Run `npm run typecheck --workspace @faze/api` and `npm test --workspace @faze/api`. For connection-policy checks without any database, run `npx vitest run --config vitest.unit.config.ts` from services/api.

Publish sets through POST /admin/sets/:id/publish. PATCH status=live is rejected so draft validation cannot be bypassed. The publish endpoint validates art and odds before making the set visible and records a publish_set job.

Admin art uploads: POST /admin/art with {base64,mimeType} requires an admin session. Accepts canonical base64 PNG/JPEG/WebP content with matching magic bytes, maximum 2MB decoded. SVG uploads are rejected. Files are stored under UPLOAD_DIR (default repository .data/uploads) and returned as /uploaded-art/<uuid>.<extension>; resolve this URL against the API origin. Provision persistent storage for UPLOAD_DIR when deploying. Public GET serves image bytes with fixed MIME and nosniff headers; trusted seed SVGs use the separate /demo-art route.
