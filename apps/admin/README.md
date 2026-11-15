# Staff console

From the root, install dependencies then run `npm run dev --workspace @faze/admin`; open http://localhost:3001. Configure `NEXT_PUBLIC_API_URL` (default http://localhost:4000) and include the admin origin in the API's CORS allow list. Only this public API URL belongs in browser configuration; no database secrets are sent to the browser.

Sign in using the seeded admin account, then manage sets/cards/packs, upload original or licensed PNG/JPEG/WebP art (2 MB), publish, approve/reject pending submissions, and queue a simulated engagement spike. Art upload requires A's POST /admin/art endpoint; other writes use the documented admin contract. All API requests carry the httpOnly session cookie. Fan accounts see an access-denied screen and the API enforces the role independently.

Keep the worker running for automatic flags, queued jobs and simulated hype updates. Refresh the queue/leaderboard after processing. Published sets appear through the real API store endpoint. No content or payment results are synthesized by this UI.

Validate with `npm run typecheck --workspace @faze/admin` and `npm run build --workspace @faze/admin`.
