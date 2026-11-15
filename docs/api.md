# API contract — v1.6 FROZEN (2026-11-15: v1.6 Control Room, v1.5 relative artUrl + card art in DB, v1.1 payments → Solana devnet, v1.2 user search, v1.3 art upload, v1.4 fan-art submissions + /uploaded-art; changes only via the lead on the board)

Base URL `services/api`: `http://localhost:4000`. Payments `services/payments`: `http://localhost:4100`. JSON in and out. Auth via httpOnly JWT cookie `session`: HS256 signed with `JWT_SECRET`, claims `{sub: userId, role: "fan"|"admin", exp}`, 7-day expiry, `SameSite=Lax`, `Path=/`. Every service that needs the user verifies this cookie with the shared `JWT_SECRET`.

Errors: `{ "error": { "code": "STRING_CODE", "message": "human text" } }`. Codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION` 400, `INSUFFICIENT_COINS` 409, `CARD_LOCKED` 409, `TRADE_NOT_OPEN` 409, `CONFLICT` 409.

## Auth & users (A)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/signup` | `{email, password, displayName}` → `{user}` (+500 demo coins) |
| POST | `/auth/login` | `{email, password}` → `{user}` |
| POST | `/auth/logout` | → `204` |
| GET | `/me` | → `{user, balance}` |
| GET | `/users?q=<prefix>` | → `{users: [{id, displayName}]}` — approved display names only, max 10 (v1.2, trade picker) |

## Art (A)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/art/:file` | public image; served with its stored content type and `X-Content-Type-Options: nosniff`; file names are server-generated (v1.3) |
| GET | `/demo-art/:uuid.svg` | committed seed art from `content/seed/art/` (D-owned, reviewed SVGs); uuid names only, nosniff, CSP sandbox. Uploads never land here (v1.3) |

## Packs & collection (A)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/packs` | → `{packs: [{id, name, setId, priceCoins, cardsPerPack, odds, oddsVersion}]}` |
| POST | `/packs/:id/open` | `{idempotencyKey}` → `{pullId, cards: [CardInstance], balance}` |
| GET | `/me/cards` | → `{cards: [{card, instances: [{id, serial, locked}], count}]}` |
| GET | `/cards/:id` | → `{card, stats: {hype}}` |
| GET | `/users/:id/collection` | → same shape as `/me/cards` |
| GET | `/leaderboard` | → `{collectors: [{user, score}], trending: [{card, hype}]}` |

Pull rules: if a rolled card is sold out (`max_supply` reached), reroll within the same rarity; if that rarity is fully sold out, fall to the next lower rarity; if nothing is available the open fails with `CONFLICT` 409 and no coins are debited.

Leaderboard score = sum over owned instances of rarity weight: common 1, rare 3, epic 10, legendary 25. `trending` = top 10 cards by `card_stats.hype`.

## Trades (A)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/trades` | `{toUserId, offeredInstanceIds, requestedInstanceIds, message?}` → `{trade}` |
| GET | `/me/trades` | → `{incoming: [Trade], outgoing: [Trade]}` |
| POST | `/trades/:id/accept` \| `/decline` \| `/cancel` | → `{trade}` |

## Payments (B) — Phantom wallet + Solana, DEVNET only
| Method | Path | Body → Response |
|---|---|---|
| GET | `/payments/bundles` | → `{bundles: [{id, coins, lamports}], cluster: "devnet", recipient, testMode: true}` |
| POST | `/payments/checkout` | `{bundleId}` → `{purchaseId, recipient, lamports, reference, cluster, solanaPayUrl}` (creates a `pending` purchase; `reference` is a fresh pubkey) |
| POST | `/payments/confirm` | `{purchaseId, signature?}` → `{status: "paid", credited, balance}`; `409 CONFLICT` if no matching confirmed tx yet (client retries every 2 s); `400 VALIDATION` if the tx does not match |
| GET | `/me/purchases` | → `{purchases: [Purchase]}` |

Payment rules: the client builds `SystemProgram.transfer(payer → recipient, lamports)` with `reference` appended as a read-only, non-signer key, signs it in Phantom and sends it. The server credits coins **only** after fetching the transaction from the devnet RPC and checking: no error, `confirmed` commitment, `reference` is in the account keys, `recipient` balance rose by ≥ `lamports`. If `signature` is omitted the server finds it via `getSignaturesForAddress(reference)`. A signature can pay for one purchase only. Credit idempotency key: `purchase:<purchaseId>`. Mainnet is refused at boot.

## Internal (service-to-service, header `X-Internal-Secret`)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/internal/ledger/credit` | `{userId, amount, reason, refId, idempotencyKey}` → `{balance}` |

## Admin (A implements, D's admin app consumes; role `admin`)
| Method | Path | Body → Response |
|---|---|---|
| GET/POST | `/admin/sets` | list / create `{name, description}` |
| PATCH | `/admin/sets/:id` | edit |
| POST | `/admin/sets/:id/publish` | validates, sets `live` |
| GET/POST | `/admin/cards` | list / create `{setId, name, fazeMember, rarity, artUrl, basePower, maxSupply?}` |
| PATCH | `/admin/cards/:id` | edit |
| POST/PATCH | `/admin/packs` | create / edit odds and price |
| POST | `/admin/art` | `{filename, contentType: "image/png"\|"image/jpeg"\|"image/webp", dataBase64}` (≤ 2 MB decoded) → `{artUrl}` (v1.3). SVG not accepted. |
| GET | `/admin/moderation?status=pending` | → `{submissions}` |
| POST | `/admin/moderation/:id` | `{decision: "approve"\|"reject"}` |
| POST | `/admin/engagement/spike` | `{fazeMember}` → `{jobId}`; inserts a `jobs` row (`engagement_spike`) that D's worker picks up |

Signup and `POST /trades` with a message also insert a `pending` `submissions` row; the display name / message is hidden from other fans until approved.

Shapes for `User`, `Card`, `CardInstance`, `Trade`, `Purchase`, `Submission` follow `docs/data-model.md` in camelCase and live in `packages/shared`.

## Admin artwork upload + fan-art submissions (v1.4, lead-approved)
**v1.5 (supersedes the v1.4 absolute-URL rule):** `artUrl` is stored and returned as a **relative path** (`/art/<id>.<ext>`; legacy `/uploaded-art/…` and `/demo-art/…` keep working). Clients resolve it against the API base they already call (`new URL(artUrl, API_BASE)`). Reason: absolute URLs baked `localhost:4000` into the database and broke phone/LAN demos and any second host.
**v1.5 card art lives in the database:** table `card_art (id uuid PK, mime text, bytes bytea, sha256 text, demo bool, created_at)` via A's migration 002. `/admin/art` and `/submissions/fan-art` write there; `npm run seed` imports the committed `content/seed/art/*.svg` (trusted seed SVGs only — uploads still reject SVG). `GET /art/:id(.ext)` serves from the DB with the stored mime, `nosniff`, CSP sandbox and an immutable cache header.
POST `/admin/art` requires an admin session. Body `{base64,mimeType}` accepts canonical base64 PNG, JPEG or WebP up to 2 MiB; server validates image signatures and MIME. Returns `{artUrl}` under `/uploaded-art/<uuid>.<ext>`. GET of that URL serves fixed content type with nosniff. Uploaded SVG is rejected; original seed SVGs use the separate trusted `/demo-art/` route. Configure durable server storage through UPLOAD_DIR.
`POST /submissions/fan-art` requires a fan session and `{name,base64,mimeType}` with the same 2 MiB PNG/JPEG/WebP validation. Returns `{submission}` with status pending and queues automatic moderation atomically. Bytes remain in the private moderation payload; no public art URL is issued before staff review. Approval alone does not mint cards or bypass staff publishing.
Compatibility: `/admin/art` accepts both `{base64,mimeType}` and the v1.3 `{filename,contentType,dataBase64}` form. The legacy form returns an absolute `/art/<uuid>.<ext>` URL; the new form returns `/uploaded-art/<uuid>.<ext>`. Both public routes serve the same validated stored artwork. UPLOAD_DIR takes precedence over legacy ART_DIR.

## Control Room — business operations (lead, v1.6; all `requireAdmin`)
Lives in `services/api/src/routes/control.ts` + `src/control/*`; UI in `apps/client/app/admin/control/**` (served at `/admin/control` in the fan app). Launch and end call the existing `/admin/sets|cards|packs|publish` endpoints with the admin's own session, so their validation and publish checks still apply.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/admin/control/overview` | → `{kpis, health, series: {pullsByHour, coinsByDay}, topMembers}` |
| GET | `/admin/control/archive?q=&member=&limit=` | full-text search over `archive_moments` → `{moments}` |
| GET | `/admin/control/kam` | latest scan → `{scanId, scannedAt, opportunities: [{id, status, score, signals[5], recommendation, moment}]}` |
| POST | `/admin/control/kam/scan` | scores every collectible-fit archive moment against live data, keeps the top 12 → same shape + `scanned` |
| POST | `/admin/control/opportunities/:id/dismiss` | → `{ok}` |
| GET | `/admin/control/campaigns` | → `{campaigns}` (with `pulls`) |
| POST | `/admin/control/campaigns` | `{opportunityId}` → `201 {campaign, assets[5], moment}` (draft, archive-grounded drafts, duplicate-checked) |
| GET | `/admin/control/campaigns/:id` | → `{campaign, assets, moment}` |
| PATCH | `/admin/control/campaigns/:id/assets/:assetId` | `{name?, lore?, rarity?}` (draft/rejected only; re-runs duplicate check) |
| POST | `/admin/control/campaigns/:id/regenerate` \| `/submit` | draft → `pending_approval` |
| POST | `/admin/control/campaigns/:id/review` | `{decision: approve\|reject, rightsConfirmed, rightsNote?, note?}`; approve needs `rightsConfirmed: true` and no duplicate ≥ 0.82 |
| POST | `/admin/control/campaigns/:id/launch` | `{packPriceCoins?}` approved → live: creates set, 5 cards, pack (odds over present rarities), publishes |
| POST | `/admin/control/campaigns/:id/end` | live → ended: pack `active=false`, set `retired` |
| GET | `/admin/control/campaigns/:id/metrics` | → `{pulls, collectors, demoCollectors, coinsSpent, cardsMinted, tradesInvolvingDrop, avgHype, attributedPurchases, attributedSol, attribution, rarityMix, pullsByMinute}` |
| POST | `/admin/control/campaigns/:id/simulate` | `{collectors ≤ 40}` DEMO ONLY: creates `demo` fans who open the drop through the real `/packs/:id/open` |
| GET | `/admin/control/audit?limit=` | → `{entries}` (append-only `audit_log`) |

External reach hook (for Moment Scout, v1.7): if a view `scout_moment_views(moment_key, views, fetched_at)` exists, KAM uses its views for archive moments whose `key` matches, counting only rows fetched in the last 30 days. API statistics must never be written into `archive_moments.summary` (Studio copies summary text into card lore). KAM also never writes the live view count into stored scan evidence (`opportunities.signals`); it uses the count for points only.

KAM score = sum of 5 explained signals (anniversary 30, member momentum 25, collector demand 20, catalog gap 10, archive weight 15). Moments about lawsuits, gambling, health, harm, controversy, or business deals with no featured member are never recommended. Studio's default writer (`template`) only reuses the archive entry's own sentences; `OLLAMA_URL` (+ `OLLAMA_MODEL`) optionally rewrites lore and falls back to the template on any error.

## Public marketplace extension
See [marketplace.md](marketplace.md) for public listings, private exchange offers and notifications. Existing direct-trade endpoints remain supported.

## Control Room — intelligence, sponsors, operations (lead, v1.8; all `requireAdmin`)
`services/api/src/routes/insights.ts`, migration `006_sponsors.sql`. UI: `/admin/control/fans`, `/revenue`, `/trust`.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/admin/control/fans` | → `{funnel, cohorts[14d: size, activatedD0, retainedD1/D3/D7 (null until the cohort is old enough)], segments, spend.topDecileShare, creatorDependence{members, hhi, topMemberShare, risk}, topCollectors}` — fans only, activity = pack opens, trades, paid purchases |
| GET | `/admin/control/revenue` | → `{purchases (devnet SOL, payers, conversion, ARPPU), byBundle, solByDay, economy{issued, issuedBy, sunk, outstanding, sinkRatio}, campaigns[coins + sponsorFeesUsd]}` |
| GET | `/admin/control/sponsors` | → `{sponsors[{…, activations[{feeUsd, collectorsReached, packOpens, costPerCollectorUsd}], totalFeeUsd}]}` |
| POST | `/admin/control/sponsors` | `{name, category, notes?}` → `201 {id}`; gambling/betting/alcohol/tobacco/vape refused (400); duplicate name 409 |
| PATCH | `/admin/control/sponsors/:id` | `{status: active\|paused}` |
| POST | `/admin/control/sponsors/:id/activations` | `{campaignId, feeUsd?, deliverables?}` → `201`; campaign must be approved/live/ended; one per sponsor+campaign |
| POST | `/admin/control/sponsors/activations/:id/end` | → `{ok}` |
| GET | `/admin/control/ops` | → `{health, jobs{byKindStatus, recent}, moderation[pending, text only — never image bytes], rights[register], migrations, users}` |

Sponsor fees are demo contract values for reporting; no money moves. Moderation actions in the UI use the existing `POST /admin/moderation/:id`.

## Moment Scout (v1.7 — draft for lead review)

Admin route: `/admin/control/scout` (Moment Scout → Possible cards). Every API below requires an admin session; ordinary users receive 403, missing sessions 401. This extends the Control Room and feeds its archive/KAM workflow; it does not create or publish cards directly.

| Method | Path | Request / response |
|---|---|---|
| GET | `/admin/control/scout` | Query: `status=new\|shortlisted\|rejected\|promoted\|all` (default `new`), `q` (title substring, ≤150 chars), `minViews` (nonnegative integer), optional `year` (2005 through current UTC year), `offset` (0–100000). Returns `{configured, channel, source, counts, total, offset, candidates}`; 30 results/page, lifetime views descending, unknown counts last. |
| POST | `/admin/control/scout/scan` | Optional `{restart:false}`. Reads up to three upload pages (150 playlist entries), stores public metadata, resumes from the server cursor. `{restart:true}` begins at latest uploads. Returns `{saved,pages,requests,hasMore}`; `saved` counts returned/upserted records, not necessarily new videos. |
| POST | `/admin/control/scout/:videoId/refresh` | Refreshes one known video. Returns `{available}`. Missing/private/deleted/unrecognized videos lose stored metadata; review status remains. |
| PATCH | `/admin/control/scout/:videoId` | `{status:new\|shortlisted\|rejected, note?:string}` (≤1000 chars). Returns `{status}`. Promoted candidates cannot be reverted here. |
| POST | `/admin/control/scout/:videoId/promote` | Requires shortlisted candidate with fresh, available metadata. `{title,summary,members?,occurredOn,timestampSeconds?}`. Title 3–160 chars; summary 20–2000; members up to 12 names, each 1–80; real nonfuture `YYYY-MM-DD`; timestamp integer 0–86400 seconds. Returns `{momentId}`; repeat promotion is idempotent. |

`channel={id,name,url}` identifies the official FaZe Clan channel (`UCNdpD9V0PIrH1glUJ6RG4-w`). `source={hasMore,pagesScanned,lastScanAt}` describes discovery coverage. `counts` maps review status to all stored candidate counts; `total` is filtered. Each candidate contains `{videoId,videoUrl,metadata,fetchedAt,status,note,momentId}`. `metadata` is either null or `{title,publishedAt,thumbnailUrl,duration,views,likes,comments}`. Duration is YouTube's ISO-8601 duration. Unavailable statistics and thumbnails are null, not zero. `fetchedAt` is server retrieval time; it does not claim current views or historical viral velocity. Sorting covers only discovered videos; upload dates need not equal event dates, and Shorts/video counts may use different definitions.

Discovery uses server-only `YOUTUBE_API_KEY` (root `.env` or API environment; enable YouTube Data API v3 and restart API after configuration). The browser receives only `configured:boolean`, never the key. No key → GET still serves editorial state and the UI shows setup instructions; scans/refreshes return 409 with recovery guidance. Google credentials are sent in a header to a fixed API origin; upstream bodies/credentials are not forwarded. Requests use `channels.list` → `playlistItems.list` → batched `videos.list`, never `search.list`. A scan makes at most seven upstream requests under one 30-second deadline; scans are serialized across processes with a PostgreSQL advisory lock and require 30 seconds between successful runs. Individual refreshes require 30 seconds since retrieval. A failed scan rolls back all candidate/cursor changes; retry continues from the prior cursor.

The bot runs when an admin selects **Discover videos / Discover older videos**. It does not continuously crawl or download video. Admins watch the original, shortlist/reject, write their own editorial title/context/member list, confirm the event date, and optionally identify a clip start time. Promotion inserts `archive_moments` with key `yt:<videoId>`, source `YouTube <watch URL including timestamp>`, citations, and the existing weighted search vector. Curator prose is kept separate from API statistics; no thumbnail enters `card_art` or `campaign_assets`. KAM reads fresh counts through `scout_moment_views`, and its existing campaign and rights-approval flow decides the next step. Promotion does not guarantee a top KAM recommendation.

YouTube metadata expires at 30 days. Expired previews/counters are hidden and removed on Scout reads, scans, promotion, API startup, and a one-minute cleanup timer while the API runs. The view excludes stale counts immediately, even before cleanup. Review decisions, source IDs/links and curator-authored archive entries persist. Refresh or rediscover to restore metadata. The source cursor resets after 30 days of inactivity. Mutation audit actions are `scout.scan`, `scout.refresh`, `scout.review`, `scout.promote`, and `scout.expire`; audit details contain operation counts/IDs/statuses rather than copies of API metadata. KAM uses current views for points but does not persist their raw values in opportunity evidence.

Sources for the upstream request sequence and limits: [channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list), [playlistItems.list](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list). Integration tests in `services/api/test/scout.test.ts` mock all YouTube fetches and run against a separate `TEST_DATABASE_URL`; they require no YouTube key or quota. A live discovery smoke test remains dependent on a real configured key.
