# API contract — v0 DRAFT (lead freezes before build)

Base URL `services/api`: `http://localhost:4000`. Payments `services/payments`: `http://localhost:4100`. JSON in and out. Auth via httpOnly JWT cookie `session`.

Errors: `{ "error": { "code": "STRING_CODE", "message": "human text" } }`. Codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION` 400, `INSUFFICIENT_COINS` 409, `CARD_LOCKED` 409, `TRADE_NOT_OPEN` 409, `CONFLICT` 409.

## Auth & users (A)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/signup` | `{email, password, displayName}` → `{user}` (+500 demo coins) |
| POST | `/auth/login` | `{email, password}` → `{user}` |
| POST | `/auth/logout` | → `204` |
| GET | `/me` | → `{user, balance}` |

## Packs & collection (A)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/packs` | → `{packs: [{id, name, setId, priceCoins, cardsPerPack, odds, oddsVersion}]}` |
| POST | `/packs/:id/open` | `{idempotencyKey}` → `{pullId, cards: [CardInstance], balance}` |
| GET | `/me/cards` | → `{cards: [{card, instances: [{id, serial, locked}], count}]}` |
| GET | `/cards/:id` | → `{card, stats: {hype}}` |
| GET | `/users/:id/collection` | → same shape as `/me/cards` |
| GET | `/leaderboard` | → `{collectors: [{user, score}], trending: [{card, hype}]}` |

## Trades (A)
| Method | Path | Body → Response |
|---|---|---|
| POST | `/trades` | `{toUserId, offeredInstanceIds, requestedInstanceIds, message?}` → `{trade}` |
| GET | `/me/trades` | → `{incoming: [Trade], outgoing: [Trade]}` |
| POST | `/trades/:id/accept` \| `/decline` \| `/cancel` | → `{trade}` |

## Payments (B)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/payments/bundles` | → `{bundles: [{id, coins, priceCents}], testMode: true}` |
| POST | `/payments/checkout` | `{bundleId}` → `{checkoutUrl}` |
| POST | `/payments/webhook` | Stripe-signed event → `200` (credits via A) |
| GET | `/me/purchases` | → `{purchases: [Purchase]}` |

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
| GET | `/admin/moderation?status=pending` | → `{submissions}` |
| POST | `/admin/moderation/:id` | `{decision: "approve"\|"reject"}` |
| POST | `/admin/engagement/spike` | `{fazeMember}` → queues a simulated spike (D's worker) |

Shapes for `User`, `Card`, `CardInstance`, `Trade`, `Purchase`, `Submission` follow `docs/data-model.md` in camelCase and live in `packages/shared`.
