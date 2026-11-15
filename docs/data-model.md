# Data model — v1 FROZEN (2026-11-15; changes only via the lead on the board)

Postgres, one database shared by all services. Migrations owned by Agent A in `services/api/migrations/` (including tables other agents write, e.g. `purchases`, `card_stats`, `engagement_events`). All ids are UUIDs; all timestamps `timestamptz`. `demo boolean` marks seeded or simulated rows.

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
| `purchases` | id, user_id, stripe_session_id (unique), stripe_event_id (unique), bundle_id, coins, amount_cents, test_mode (always true for demo), status, created_at | B |
| `submissions` | id, user_id, kind (`display_name`\|`trade_message`\|`fan_art`), ref_id (user or trade id), payload (jsonb), status (`pending`\|`approved`\|`rejected`), auto_flags (text[]), reviewed_by, reviewed_at, created_at | A inserts `pending` rows (same transaction as signup / trade create); D's worker sets `auto_flags`; admin decides via A's admin API |
| `jobs` | id, kind (`engagement_spike`\|`publish_set`\|`moderate`), payload (jsonb), status (`queued`\|`running`\|`done`\|`failed`), error, created_at, updated_at | A inserts; D's worker polls with `FOR UPDATE SKIP LOCKED` |
| `engagement_events` | id, faze_member, metric (`views`\|`likes`\|`mentions`), value, simulated (always true for demo), created_at | D (worker) |

## Roles
- `role = admin` is set only by the demo seed script (`admin@demo.faze`, labelled demo). No API promotes a user.

## Invariants
- Balance = `SUM(ledger.amount)` per user; never negative (checked in the same transaction as the debit).
- `ledger.idempotency_key` unique → retries and replayed webhooks cannot double-credit.
- A `card_instance` with `locked_by_trade_id` set cannot be offered in another trade.
- Trade accept: verify both sides still own and have locked the instances, swap `owner_id`, clear locks — one transaction.
- Serial = `max(serial)+1` per card, assigned under a row lock on `cards`. A card at `max_supply` is sold out.
- `packs.odds` sums to 100; every pull stores the `odds_version` it used.
- Nothing with a `pending` or `rejected` moderation status is visible to other fans.
