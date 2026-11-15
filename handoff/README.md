# Handoff: branch `toosh` (Tush's ClipDeck build)

Written 2026-11-15. Read this first, then the linked docs in this folder. It lists what is done on `toosh`, what is still to build, and how to resume with **one agent**, so we spend fewer tokens.

- **Product spec (source of truth):** `C:\Users\tusha\Downloads\ClipDeck — Product & Build Spec.pdf` (22 pages).
- **Exact API shapes and economy numbers:** [`clipdeck-contract.md`](clipdeck-contract.md)
- **Battle and trading game design, with the balance simulation:** [`game-logic.md`](game-logic.md)
- **Twitch watch-along design:** [`twitch-watch-along.md`](twitch-watch-along.md)
- **Clip → face → card pipeline design:** [`clip-face-pipeline.md`](clip-face-pipeline.md)
- **Business proposition for the pitch deck:** [`business-prop.md`](business-prop.md)
- **Team rules:** `AGENTS.md`. `toosh` is Tush's own branch. Nothing from it reaches `main` without going through @tanejakeshav (the integrator), and owners must be told on the board (`tools/board`).

## 1. State of `toosh` (pushed to origin)

All 118 API tests pass and every workspace typechecks.

| Area | What's done | Where |
|---|---|---|
| Card art in the DB (contract v1.5) | `card_art` table, relative `/art/<id>`, seed imports SVGs | `services/api` migration 002, `art-store.ts` (already on main) |
| Trading fixes | Direct trades send notifications, accept sets `acquired_at`, marketplace search escapes `%`/`_` | `routes/trades.ts`, `routes/marketplace.ts` |
| FaZe-brand UI | Brand tokens, brush-stroke splash, `polish.css`, pack reveal with the epic/legendary screen glitch | `apps/client/app/*` (already on main) |
| Twitch watch page and Clip Lab | Paste any Twitch link, capture a frame by tab capture, detect faces, crop to 5:6, send to card generation (rights-gated) | `apps/client/app/watch/**` |
| Clip/frame → face → card art pipeline | YuNet face detection (local), scoring, card composer, Studio draft gate | `services/api/src/pipeline/*`, `routes/pipeline.ts`, migration 007 |
| Battles | Stats, deterministic resolver, Vault bosses with 4 tiers, practice, XP and badges | `services/api/src/battle/*`, `routes/battles.ts`, migration 008 |
| Battle tab UI | Lineup builder, Vault panel, full-screen replay (Trickshot/Clutch), progress | `apps/client/app/battle/**` (+ `?battleMock=1` fixture) |
| ClipDeck schema | eras, clips, daily packs, live drops/claims, shop offers, cosmetics, rarity override log; ledger, submission and job enums widened | migration `009_clipdeck.sql` (applied and re-runnable; **no routes yet**) |
| Merged with main | PR #10 (packs bought directly with SOL; the Coins tab is gone). Battle tab and header WATCH link kept | `apps/client/app/page.tsx` |

**Verified in a real browser with Playwright:**
- splash, store and pack opening, including a real legendary glitch;
- the Clip Lab flow end to end, from frame through detect and generate to the draft in the Control Room;
- the card modal closes with Escape.

**Not yet run against the real API:** the Battle UI. It was only tested with the mock, so do a real battle run next.

## 2. Still to build (in this order)

Every ClipDeck item follows `clipdeck-contract.md` exactly: routes, error codes and numbers. Migration 009 already has the tables. Only add new migrations from **010** up.

### P0: ClipDeck core (spec demo-script steps 1–2)
1. **Daily free pack (API):**
   - Endpoints: `GET /odds`, `GET /packs/daily`, `POST /packs/daily/open`.
   - Rules: 5 cards, slots 1–4 at 70/22/7/1, slot 5 rare or better, pity forces a Legendary on the 30th pack without one, guarded by `UNIQUE(user,day)` (a second open returns `ALREADY_OPENED`).
   - Put the constants in `src/clipdeck/economy.ts`.
2. **Streak:** `POST /me/checkin` pays 10/15/20/25/30/40/50 coins over the 7 days of a streak. `GET /me` also returns `streakDays`, `pityCount` and the equipped frame and skin.
3. **Binder:** `GET /binder` lists eras → sets → cards, including missing cards (shown as silhouettes) and per-set progress. Completing a set pays 500 coins and grants the KAM `skin:<era>`, both idempotent.
4. **Dust:** `POST /cards/instances/:id/dust` pays 5/20/60/200 by rarity. It only works on duplicates (`NOT_DUPLICATE` otherwise) and refuses locked cards.
5. **Card mapper:** extend it with `lore`, `era`, `frame`, `clipUrl`, `clipperHandle` and `isLiveMoment`. Add `GET /cards/:id/share.png` (1200×630, built with sharp).
6. **Seed content:**
   - 4 eras × 20 = 80 moment cards: MW2 Trickshots, FaZe House, Streamer Era, Esports.
   - Lore in KAM's voice, grounded in `content/archive/` (no invented quotes, no controversy).
   - Original SVG art with no faces.
   - Engagement numbers so rarity can be ranked by percentile within each era.
   - Retire the old demo sets.
   - Real clip URLs only where you are certain; otherwise use `https://example.invalid/demo/<slug>`.

### P1: Live Moments and the economy (demo step 3)
7. **Live drops:**
   - Endpoints: `GET /drops/live`, `POST /drops/:id/claim`, `POST|GET /admin/drops`.
   - Claim behaviour: the serial is assigned by `UPDATE … claim_count+1 RETURNING`; claiming pays 25 coins; claimed cards can't be traded for 7 days (enforce this in the trade and marketplace create paths). Errors are `ALREADY_CLAIMED` and `DROP_EXPIRED`.
8. **Fan clip submissions:**
   - `POST /submissions/clips`: https only, host allowlist, 3 per day, `DUPLICATE_URL`, the clipper must confirm, a banned-word list.
   - `GET /me/submissions/clips` lists the user's own submissions.
9. **Admin clips:**
   - Endpoints: list, add an archive clip, review with a reason, and `POST /admin/clips/:id/card`.
   - Rarity comes from the era percentile (spec §1 SQL, score = views + 20·likes + 50·comments). A staff override is logged in `rarity_overrides`.
   - Making a card from a fan clip pays the fan 300 coins and gives them copy #1.
10. **Shop:**
    - `GET /shop`.
    - Pick 1 of 3 (400 coins): all 3 cards are shown before the fan chooses, it is idempotent, and the offer expires after 15 min (`OFFER_EXPIRED`).
    - Card frames cost 600 coins and KAM era skins cost 1200. `POST /me/equip` applies them.
    - Spending more than the balance returns `INSUFFICIENT_COINS`.
11. **Economy:** `GET /admin/economy` shows the odds, ledger totals by reason, coins outstanding, top earners and flagged accounts.

### P1: Fan app screens (`apps/client/app/clipdeck/**`, CSS scoped `.cd-root`)
12. **Today** (the default tab): the daily pack, the streak check-in, the pity counter, set progress, and a Live Now banner (poll every 15 s).
13. **Daily pack reveal with KAM the Killcam:**
    - KAM is an original inline-SVG camera-robot mascot.
    - States: idle, curious, hype (epic), losing-it (legendary).
    - The equipped skin recolours him.
14. **Binder:** silhouettes for missing cards, a progress bar per set, a set-complete celebration, and Dust on duplicates.
15. **Card detail:** lore, era, the equipped frame, edition number, clip link, clipper credit, and Share (`navigator.share`, falling back to the PNG).
16. **Live Moment modal:** a 10-minute countdown, the claim count and a Claim button that shows "You got #N".
17. **Shop** (primary store tab):
    - pick 1 of 3, frames, skins and equip;
    - the random SOL/coin packs move into a **"Classic packs (legacy demo)"** section.
    - Spec rule: nothing you pay for is random. Tush still has to decide whether to keep those packs at all.
18. **Submit a clip** form, the user's own submissions, and an **Odds** page.

### P1: Admin pages (Control Room shell, `apps/client/app/admin/control/**`)
19. **Clips:** pending, approved and rejected lists, the archive form, review, and "Make card" (rarity override with a reason; art from Clip Lab).
20. **Live Moments:** fire a drop (labelled SIMULATED or TWITCH), a live countdown and claim count, and drop history.
21. **Economy** page.

### P2: Twitch clips and AI person cutout (Tush's request: "real clips → AI cuts out the person → card")
22. **Twitch Helix client** in `services/api/src/twitch/*`, using the official API only (no HTML scraping, no yt-dlp):
    - app token by client credentials;
    - Get Users, **Get Clips** (paginated and bounded) and **Get Streams**.
23. **Migration `010_twitch_clips.sql`:**
    - `clips.source` gains `'twitch'`;
    - new clip columns: `twitch_clip_id` (unique), `thumbnail_url`, `creator_name`, `vod_offset_s`, `twitch_created_at` and `duration_s`;
    - a new `twitch_sync_runs` table.
24. **Twitch routes:**
    - `GET /twitch/live` (cached 60 s);
    - `POST /admin/twitch/clips/sync` (the era comes from the clip's year);
    - `GET /admin/twitch/clips`;
    - `POST /admin/twitch/clips/:id/analyze`: fetch the official thumbnail (host allowlist, at most 8 MB), then run it through the existing face-frame flow.
25. **AI person cutout (local):**
    - Model: U²-Net human-seg / u2netp from the official rembg GitHub releases (Apache-2.0), run with onnxruntime-node. Use MODNet as the fallback.
    - If the model is over 10 MB, gitignore it and add `npm run models` with a sha256 check.
    - `pick` gains `style: 'photo'|'cutout'`, which composites the cutout onto an era background.
    - Add a cutout preview route.
26. **Twitch Clips admin page:** sync, a clip grid, approve/reject, and Make card (analyze → candidate → Photo or AI cutout → generate → draft). Add a **LIVE pill** to `/watch` and next to the header WATCH link.
27. **Live Moments from Twitch:** when the channel is live, drops get `source:'twitch'`.

**Needed from Tush:** register a Twitch app at dev.twitch.tv/console, then put `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in your local `.env` (never in chat or git). `TWITCH_CHANNEL` defaults to `faze`.

**Rights note:** the spec's rule is "moments, not people". Tush asked for person cutouts, so they stay a **staff tool** behind the rights confirmation and the Studio approval gate. They use detection only: no recognition, no stored embeddings or landmarks, no third-party AI APIs (the lead's conditions).

### P3: Finish and demo
28. **Battle v2** (`game-logic.md`): ranked ghost lineups + Elo ladder, Fuse (5 duplicates → the next rarity, player picks), trade Value Index, set-progress goals, anti-wash trade cooldown, and Moment-card abilities.
29. **Full Playwright run:**
    - the spec's 2-minute demo script: daily pack + KAM, binder + lore, an admin Live Moment → claim #1, buying a KAM skin with coins (coins bought with devnet SOL);
    - a real battle, a trade and a Clip Lab card.
30. **Pitch deck fixes** (Canva "FaZe Collector Cards — Pitch Deck"):
    - remove "0 paid items that are random", or make it true by dropping the paid random packs;
    - correct the tech slide: Fastify not FastAPI, devnet SOL not USDC, no OpenAI;
    - add the Control Room, battles and the risks/compliance slide.
    
    Screenshots are in the session scratchpad `deck-assets\` (not durable; re-capture with the Playwright scripts if they're gone).
31. **Merge to main:** sync `origin/main` first. Main may get a `007_moments_game.sql`; whoever lands second renumbers (toosh uses 007–009, plus 010 for Twitch). Then hand off to @tanejakeshav with a board post, tagging @Jaideepo7 for `apps/client`.

## 3. Open decisions for Tush (each one changes code or the pitch)
1. Keep the paid random packs, which conflicts with "nothing you pay for is random", or remove them and sell only pick-1-of-3 and cosmetics?
2. Payment rail: the spec says devnet USDC, but the lead chose devnet SOL. Cosmetics are priced in coins either way.
3. Are person cutouts fine for the demo, given the spec's "moments, not people" rule?
4. Battle rewards stay XP and badges, with no coins and no pack tokens. Confirm.
5. Database: Docker Postgres for the demo, or Tiger Cloud (the lead's call)?

## 4. How to resume with one agent (cheaper)
- Work directly on `toosh` in the main checkout. **Don't spawn parallel worktree agents:** several started from `main` instead of `toosh`, and stopping them cost tokens with nothing committed.
- **Order:** do P0 (items 1–6) as one API commit plus one seed commit, run the tests, then build the Today/pack/Binder UI. P1 and P2 come after that.
- **Checks after each step:**
  - `npm run typecheck`;
  - API tests on a throwaway DB: `docker exec hackutafaze-db-1 psql -U faze -d faze -qc "CREATE DATABASE faze_t;"` then `TEST_DATABASE_URL=postgres://faze:faze@localhost:5432/faze_t npm test -w @faze/api` (DROP it after);
  - a Playwright check using the Playwright install in the session scratchpad `pw\`. If it's gone, run `npm i playwright@1.49.1` in a scratch dir; the Chromium build 1148 is cached.
- **Dev stack:**
  - start it with `npm run dev`;
  - fan app at :3000, staff at `/admin` (`admin@demo.faze` / `demo-admin-pass`), fans `fan1..4@demo.faze` / `demo-fan-pass`;
  - local dev DB `faze_dev` in Docker, with `.env` generated locally (`PAYMENTS_SIMULATE=1`).
- **Windows notes:**
  - `npm install` drops other-platform optional entries from `package-lock.json`, so run `git checkout -- package-lock.json` unless a dependency was really added;
  - stopping `npm run dev` leaves its node processes behind, so free ports 3000/4000/4100 by PID before restarting.
- **Leftover agent worktrees** (`.claude/worktrees/agent-*`) contain nothing to keep. Remove them with `git worktree remove --force <path>`, plus `git branch -D worktree-agent-*` once you no longer need them.
