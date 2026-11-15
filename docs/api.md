# API contract — v1.3 FROZEN (2026-11-15: v1.1 payments → Solana devnet, v1.2 user search, v1.3 art upload; changes only via the lead on the board)

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

## Admin artwork upload
POST `/admin/art` requires an admin session. Body `{base64,mimeType}` accepts canonical base64 PNG, JPEG or WebP up to 2 MiB; server validates image signatures and MIME. Returns `{artUrl}` under `/uploaded-art/<uuid>.<ext>`. GET of that URL serves fixed content type with nosniff. Uploaded SVG is rejected; original seed SVGs use the separate trusted `/demo-art/` route. Configure durable server storage through UPLOAD_DIR.
`POST /submissions/fan-art` requires a fan session and `{name,base64,mimeType}` with the same 2 MiB PNG/JPEG/WebP validation. Returns `{submission}` with status pending and queues automatic moderation atomically. Bytes remain in the private moderation payload; no public art URL is issued before staff review. Approval alone does not mint cards or bypass staff publishing.
