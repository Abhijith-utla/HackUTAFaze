# Data model — v1.1 FROZEN (2026-11-15, payments → Solana devnet; changes only via the lead on the board)

PostgreSQL, one database shared by all services (local docker by default; managed hosting such as Tiger Cloud pending the lead's decision). Connect from server services through DATABASE_URL with TLS and connection pooling. Use isolated development/test databases. Preserve all existing SQL transaction and uniqueness invariants. Migrations owned by Agent A in `services/api/migrations/` (including tables other agents write, e.g. `purchases`, `card_stats`, `engagement_events`). All ids are UUIDs; all timestamps `timestamptz`. `demo boolean` marks seeded or simulated rows.

| Table | Key columns | Writer |
|---|---|---|
| `users` | id, email (unique), password_hash, display_name, role (`fan`\|`admin`), display_name_status (`pending`\|`approved`\|`rejected`), demo, created_at | A |
| `ledger` | id, user_id, amount (int, +credit / −debit), reason (`signup_bonus`\|`pack_open`\|`purchase`\|`admin_grant`), ref_id, idempotency_key (unique), demo, created_at | A (B via internal endpoint) |
| `card_sets` | id, name, description, status (`draft`\|`live`\|`retired`), demo, published_at | A (D via admin API) |
| `cards` | id, set_id, name, faze_member, rarity (`common`\|`rare`\|`epic`\|`legendary`), art_url, base_power, max_supply (null = unlimited), demo | A (D via admin API) |
| `card_stats` | card_id (PK), hype (int 0–100), updated_at | D (worker) |
| `packs` | id, set_id, name, price_coins, cards_per_pack, odds (jsonb `{rarity: percent}`, sums to 100), odds_version, active | A (D via admin API) |
| `card_instances` | id, card_id, owner_id, serial (int, unique per card_id), locked_by_trade_id (nullable), acquired_at | A |
| `pulls` | id, user_id, pack_id, odds_version, card_instance_ids (uuid[]), created_at | A |
| `trades` | id, from_user_id, to_user_id, offered_instance_ids, requested_instance_ids, message, message_status, status (`open`\|`accepted`\|`declined`\|`cancelled`), created_at, resolved_at | A |
| `purchases` | id, user_id, bundle_id, coins, lamports (bigint), reference (unique, Solana Pay reference pubkey), recipient (treasury pubkey), tx_signature (unique, nullable), cluster (`devnet`), test_mode (always true), status (`pending`\|`paid`\|`expired`), created_at, paid_at | B |
| `submissions` | id, user_id, kind (`display_name`\|`trade_message`\|`fan_art`), ref_id (user or trade id), payload (jsonb), status (`pending`\|`approved`\|`rejected`), auto_flags (text[]), reviewed_by, reviewed_at, created_at | A inserts `pending` rows (same transaction as signup / trade create); D's worker sets `auto_flags`; admin decides via A's admin API |
| `jobs` | id, kind (`engagement_spike`\|`publish_set`\|`moderate`), payload (jsonb), status (`queued`\|`running`\|`done`\|`failed`), error, created_at, updated_at | A inserts; D's worker polls with `FOR UPDATE SKIP LOCKED` |
| `card_art` | id, mime (`image/png`\|`image/jpeg`\|`image/webp`\|`image/svg+xml` seed-only), bytes (bytea, ≤ 2 MB), sha256, demo, created_at (v1.5) | A (admin upload, fan-art, seed import) |
| `engagement_events` | id, faze_member, metric (`views`\|`likes`\|`mentions`), value, simulated (always true for demo), created_at | D (worker) |

## Roles
- `role = admin` is set only by the demo seed script (`admin@demo.faze`, labelled demo). No API promotes a user.

## Invariants
- Balance = `SUM(ledger.amount)` per user; never negative (checked in the same transaction as the debit).
- `ledger.idempotency_key` unique → retries and repeated confirms cannot double-credit.
- `purchases.tx_signature` unique → one Solana transaction pays for at most one purchase.
- A `card_instance` with `locked_by_trade_id` set cannot be offered in another trade.
- Trade accept: verify both sides still own and have locked the instances, swap `owner_id`, clear locks — one transaction.
- Serial = `max(serial)+1` per card, assigned under a row lock on `cards`. A card at `max_supply` is sold out.
- `packs.odds` sums to 100; every pull stores the `odds_version` it used.
- Nothing with a `pending` or `rejected` moderation status is visible to other fans.

## Optional managed provisioning (only if the lead adopts Tiger Cloud)
Follow the [Tiger Data quickstart](https://www.tigerdata.com/docs/get-started/quickstart/quickstart-5-minutes): create a Tiger Cloud service, securely save its downloaded database configuration, configure DATABASE_URL from the service URL, and verify SELECT CURRENT_DATE before migrations. Never commit downloaded credentials.

Keep economy, inventory, purchases, moderation and jobs as ordinary PostgreSQL tables. Hypertables for engagement time-series are optional and require a lead-reviewed migration covering partitioning and unique-key compatibility.

## Control Room tables (lead, v1.6 — `services/api/migrations/003_control_room.sql`)
| Table | Key columns | Writer |
|---|---|---|
| `archive_moments` | key (unique), occurred_on, precision (`day`\|`month`\|`year`), title, summary, members[], tags[], source (PDF page), citations[], search (tsvector) | loaded from `content/archive/faze-timeline.json` |
| `opportunities` | moment_id, score, signals (jsonb), recommendation, status (`new`\|`accepted`\|`dismissed`), scan_id | KAM scan |
| `campaigns` | opportunity_id, moment_id, name, pitch, status (`draft`\|`pending_approval`\|`approved`\|`rejected`\|`live`\|`ended`), generator, rights_confirmed, rights_note, pack_price_coins, set_id, pack_id, created_by, reviewed_by, launched_at, ended_at, demo | Control Room |
| `campaign_assets` | campaign_id, position, name, faze_member, rarity, lore, art_url, base_power, max_supply, duplicate_of, similarity, card_id | Studio; card_id set at launch |
| `audit_log` | actor_id, action, entity, entity_id, detail (jsonb) — append-only | every Control Room action |

## Marketplace extension
Migration 004 adds market_listings (owner, listed instance, state), market_offers (listing, bidder, offered UUIDs, state), and notifications (recipient, kind/message, offer, read/creation timestamps). card_instances gains market_listing_id and market_offer_id; at most one direct/listing/offer lock may be non-null. See marketplace.md.

## Direct SOL pack orders
Migration 005 adds purchases.pack_snapshot (jsonb quote/config/payer/idempotency key) and pack_pull_id (nullable FK pulls). Direct pack receipts use coins=0 and the existing global tx_signature uniqueness. Signature verification persists before atomic card/pull fulfillment; retries return the same pull without coin ledger writes.
