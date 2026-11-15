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

## Open Contributions (`services/api/migrations/008_contribution_proposals.sql`)

| Table | Core fields | Invariants |
|---|---|---|
| `contribution_proposals` | creator_user_id, contributor_name, title, pitch, faze_member, source_url, recipient_wallet, bounty_lamports, status, review/audit fields, payout_reference, payout_payer_wallet, payout_signature, payout_cluster, paid_at, demo | State is `pending` → `approved` → `payout_pending` → `paid`, or `pending` → `rejected`. A payout reference and signature are globally unique; only `devnet` is accepted; `paid` requires a quote, signature and timestamp. |

## Marketplace extension
Migration 004 adds market_listings (owner, listed instance, state), market_offers (listing, bidder, offered UUIDs, state), and notifications (recipient, kind/message, offer, read/creation timestamps). card_instances gains market_listing_id and market_offer_id; at most one direct/listing/offer lock may be non-null. See marketplace.md.

## Direct SOL pack orders
Migration 005 adds purchases.pack_snapshot (jsonb quote/config/payer/idempotency key) and pack_pull_id (nullable FK pulls). Direct pack receipts use coins=0 and the existing global tx_signature uniqueness. Signature verification persists before atomic card/pull fulfillment; retries return the same pull without coin ledger writes.

## Sponsors (lead, v1.8 — `006_sponsors.sql`)
| Table | Key columns | Writer |
|---|---|---|
| `sponsors` | name (unique), category (energy_drink…other), notes, status (`active`\|`paused`), demo | Control Room |
| `sponsor_activations` | sponsor_id, campaign_id (unique pair), fee_usd (demo), deliverables, status (`active`\|`ended`), ended_at | Control Room |
## Clip Clash / 007

`cards` gains clip and thumbnail UUID asset references, optional bounded clip interval, description/game/event, member/tag arrays, approval status (pending by default), and rights reference. Existing cards remain valid; artwork gameplay eligibility is defined by migration 008 below. `clip_clash_assets` stores immutable video/thumbnail bytes in PostgreSQL (Tiger compatible), never arbitrary user video URLs. Optional legacy video metadata can still be approved, but is not required for artwork gameplay.

`clip_clash_prompts` contains validated nonnegative JSON weights; five seeded prompts use Clutch (clutch 5, precision 2, teamwork 1), Comeback (comeback 5, resilience 3, clutch 1), Reaction (reaction 5, surprise 3, celebration 2), Comedy (comedy 5, surprise 2, reaction 1), Collab (collab 5, teamwork 3, creators 1).

`clip_clash_matches` persists mode, invite, state, scores' outcome, round, expiry and a private frozen five-prompt pool. `clip_clash_players` holds unique seats and users/CPU consistency. `clip_clash_cpu_pool` is explicitly configured by staff; no auto-generated clips. `clip_clash_lineups` holds five slots, unique moment per seat, human instance references and frozen clip metadata. `clip_clash_rounds` freezes prompts and prevents repeat prompts. `clip_clash_submissions` prevents duplicate seat/round and reused seat/card, stores resolved scores and explanations.

`card_instances.locked_by_game_match_id` participates in the single-reservation check with trades/listings/offers. All reservation paths and collection/purchase representations include game locks. Match writes serialize under a match row lock; human lineup selection locks instance rows in UUID order. Terminal updates release inventory locks through a database trigger. Card ownership, serials and balances do not change.

## Artwork gameplay / 008

The forward migration adds cards.game_enabled (default false), assigns curated tags to the 40 stable catalog IDs, and seeds the fixed five-card CPU deck. Video approval and rights fields remain optional legacy metadata and no longer gate game eligibility. Game lineups freeze art_url along with tags. Existing inventory locks, score rules, snapshots and ownership invariants remain unchanged. See the catalog gameplay entries for the exact 40-card annotations.

## Prompt snapshot compatibility repair / 012

Databases that recorded the original Clip Clash migration before prompt_pool was included need forward repair 012. It adds the missing match column if necessary and fills empty pools with played prompt snapshots plus unused active prompts. Existing nonempty pools and all card ownership, scores, rounds and submissions are preserved.
