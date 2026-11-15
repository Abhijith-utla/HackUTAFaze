# Design C: Game logic (battles, trading upgrades, crafting, where it lives in the web app)

Status: proposal only. No repo files changed. Working balance prototype: `scratchpad/designs/sim/sim.py` + `ex.py` (all numbers below come from it, 4,000–20,000 simulated battles per row).

Owners: API and migrations, Agent A @toosh-legacy (`services/api/`). Client, Agent C @Jaideepo7 (`apps/client/`). Contract (`docs/api.md`, `docs/data-model.md`, `packages/shared`) and Control Room UI, lead @Abhijith-utla. Seed content and worker, Agent D @tanejakeshav.

Ground rules that carry over unchanged from master.md §3: the server is authoritative, coins only move through the ledger, coins can't be cashed out, the marketplace is cards for cards, demo/simulated data is labelled. Three new rules come with this design:

- **Battles never put cards or coins at stake.** Nobody pays an entry fee or bets anything, cards are never lost, and the rewards for each mode are fixed and published. Battles never pay out coins.
- **Battle randomness is server-seeded and replayable.** Every battle stores its seed, its rules version and a round-by-round log, the same way pulls store their odds version.
- **The client only animates.** The result is committed in the same request that creates the battle, so a reload or a closed tab can't re-roll it.

---

## 0. What exists today (inputs to this design)

- **Catalog** (`content/seed/catalog.json`): 3 live sets (OG Era, Creators, Esports Moments) and 40 cards across 5 members: FaZe Banks, Apex, Rain, Adapt and Rug. `base_power` is set purely by rarity: common 25, rare 45, epic 65, legendary 85. `max_supply` is unlimited for common and rare, 100 for epic and 25 for legendary. Every `card_stats.hype` starts at 0 and the worker's simulated spikes raise it. **Consequence:** base_power alone would make every card of a given rarity identical, so the stat model below adds member role, era/set and a stable per-card spread.
- **Trading** (`routes/trades.ts`, `routes/marketplace.ts`, migration 004): direct trades plus a cards-for-cards marketplace (list one card, others offer cards). Locks are per instance (`locked_by_trade_id`, `market_listing_id`, `market_offer_id`, and at most one may be set). Swaps are atomic and use `FOR UPDATE ORDER BY id`. `acquired_at` is stamped on accept. The playwright review in `scratchpad/pw/trade/` passed 43/43 direct-trade edge cases and 59/59 marketplace cases, including races (6 parallel accepts give exactly one 200), lock release on decline, cancel and delist, and moderation of names and messages. The one failing check, "direct trades generate notifications", is fixed in `d2f27e2`.
- **Leaderboard**: the collector score is the sum of rarity weights 1/3/10/25 over owned instances. Trending is ranked by hype.
- **Migrations**: 001–004 and 006 are on `main`, 005 = Moment Scout (`agent-c/moment-scout`), and 007 = face-art pipeline (Design B, in a worktree). **This design takes `008_game.sql`.** Re-check the number at merge time; whoever lands first keeps theirs.

---

## 1. Card stat model

Every card instance has four battle stats from 1 to 99, plus a **Cost** used by the squad cap. All four are derived from data that already exists. Nothing new is stored per card except the member role table.

| Stat | Meaning | Formula (integers, clamp 1–99) |
|---|---|---|
| **POWER** | raw strength | `B + role.p + era.p + jitter(P) + serialPerk` |
| **CLUTCH** | performing under pressure | `B + role.c + era.c + jitter(C) + serialPerk` |
| **STYLE** | trickshot flair; also drives the Trickshot crit chance | `B + role.s + era.s + jitter(S) + serialPerk` |
| **HYPE** | live fan heat (simulated) | `floor((B + card_stats.hype) / 2) + era.h` (read at battle time) |

- `B` = `cards.base_power`.
- `jitter(X)` = `BigInt('0x' + sha256(cardId + ':' + X)) % 7 − 3`, a stable spread of −3 to +3 per card. Two commons of the same member differ a little, and the value never changes.
- **Member role** comes from a new `member_profiles` table (seeded by D, editable in content ops). Each role's modifiers sum to zero, so roles change the shape of a card, not its total strength.

| Role | p / c / s | Seed assignment (content decision, verify) |
|---|---|---|
| `founder` | +6 / +2 / −8 | FaZe Apex |
| `og` | −2 / +8 / −6 | FaZe Rain |
| `creator` | −6 / −4 / +10 | FaZe Banks, FaZe Adapt, FaZe Rug |
| `pro` (esports) | +4 / +8 / −12 | none in the seed yet; for Esports campaign cards |

- **Era/set** modifiers: OG Era `p −2, c −2, s +4`; Creators `h +6`; Esports Moments `c +4, s −4`. Unknown or campaign sets get 0, and Studio can set them per campaign later.
- **Serial perks** stay small so serials remain mostly a collecting thing. `#1` gets +3 to P, C and S plus a "First Edition" foil frame. `#2–#10` gets +1 to P, C and S plus a "Low Serial" badge. The perk is per instance, so the same card can have slightly different stats per copy.
- **Cost** (for the squad cap): common 1, rare 2, epic 3, legendary 4.

Hype is a live input, so the engagement spike in the demo changes battle outcomes. After a spike to hype 90, Rain / OG Era 3 goes from HYPE 32 to 77, and its Clutch bonus (below) goes from +15 to +29. The UI labels HYPE "SIMULATED" exactly as Trending does.

Derived lines for one set, computed by the prototype with hype 0 and a non-low serial:

| Card | Rarity | Role | POWER | CLUTCH | STYLE | HYPE |
|---|---|---|---|---|---|---|
| Banks / OG Era 1 | common | creator | 17 | 21 | 37 | 12 |
| Apex / OG Era 2 | rare | founder | 48 | 47 | 44 | 22 |
| Rain / OG Era 3 | epic | og | 64 | 71 | 63 | 32 |
| Adapt / OG Era 4 | legendary | creator | 77 | 78 | 99 | 42 |
| Banks / OG Era 6 | rare | creator | 38 | 42 | 62 | 22 |
| Apex / OG Era 7 | epic | founder | 72 | 68 | 62 | 32 |
| Rain / OG Era 8 | legendary | og | 80 | 93 | 86 | 42 |
| Apex / OG Era 12 | legendary | founder | 86 | 85 | 84 | 42 |
| Rain / OG Era 13 | common | og | 20 | 29 | 24 | 12 |
| Apex / Creators 12 | legendary | founder | 94 | 89 | 77 | 48 |
| Rain / Esports Moments 8 | legendary | og | 86 | 99 | 76 | 42 |

(The full 40-card table is produced by `python -I sim.py <catalog.json> table`.)

### 1a. Duplicates → crafting ("Fuse")

- **Rule:** burn 5 instances of the **same set and same rarity** to get 1 card of the **next rarity in that set**. The player **chooses** which card they get, so the result is deterministic: no random outcome, nothing loot-box-like.
- **Only duplicates can be burned.** For each `card_id`, the number burned must be at most owned − 1, so you always keep at least one copy. Every instance must be unlocked (no trade, listing or offer lock), not burned, and not in your defense lineup.
- **The target must not be sold out.** The new serial is assigned under the same `cards` row lock the pull path uses. Burned instances still count as minted, so fusing is deflationary and supply caps get tighter.
- **Limits** (tunable): 1 fused legendary per user per 7 days.
- **Storage:** add `card_instances.burned_at`. Every read must filter `burned_at IS NULL`: collection, leaderboard, trades, marketplace, user search collection and Control Room counts of owned cards. Each fuse writes a `crafting_log` row with an idempotency key.
- Master.md already lists crafting as a stretch goal; this is the concrete version.

---

## 2. Battles

### 2a. Format: "Three-Lane Showdown" (about 20–25 seconds of animation)

- **Lineup:** 3 cards in fixed slots, **Opener / Mid / Closer**. In ranked play the squad's total Cost must be at most **9** (examples: L+E+R, E+E+E, L+L+C). The Vault has no cap.
- **Three rounds**, one lane per round: your Opener against theirs, then Mid against Mid, then Closer against Closer.
- **Stat call:** each round the seeded RNG draws a stat from {POWER, CLUTCH, STYLE, HYPE} without replacement, so every battle features three of the four stats. The UI reveals it with the DecodeText effect ("ROUND 2 / STYLE").
- **Round score** = `stat + teamSynergy + swing(0..60)` plus these modifiers:
  - **Trickshot** (crit, driven by STYLE): with chance `STYLE/400` the card adds +12 and the UI shows "TRICKSHOT!". The chance is about 4–25%.
  - **Clutch** (comeback, driven by HYPE): in round 3, the side that is behind on points adds `6 + floor(HYPE × 0.3)`. This is where the simulated engagement shows up in a fight.
- **Points:** round 1 is worth 1, round 2 is worth 1 and the **Closer round is worth 2**. Being down 0–2 can still end 2–2, and ties are broken by total score. If total score is also tied, the challenger wins.
- **Team synergies** apply to all three rounds and stack:
  - **Era Stack:** all 3 cards from one set +6; 2 from one set +3.
  - **Full Squad:** 3 different members +4.
  - Era Stack and Full Squad pull in different directions. Collecting a whole set is rewarded, and it gives players a reason to trade for specific cards (§3).
- Moment cards add one ability each (§4c).

### 2b. Modes

| Mode | Opponent | Limits | Rewards (fixed, published) |
|---|---|---|---|
| **Vault Challenge** (PvE, daily) | A daily boss built from a live campaign or archive moment. 3 boss cards with fixed stat lines and 4 tiers: Rookie 20, Pro 40, Elite 60, Legend 78 (boss stats `v / v+4 / v−4 / v`). | 3 attempts per tier per day | First clear of each tier per day: XP (Rookie 50 / Pro 100 / Elite 200 / Legend 400). The first Pro+ clear also gives **1 Pack Token** for that campaign's pack (v2). Legend clear: a profile badge for that boss. |
| **Ranked** (async PvP) | A **ghost**: another fan's saved defense lineup, resolved by the server with no live opponent and no realtime infrastructure. | 10 rewarded battles per day; extra battles are unranked practice | Ladder rating (Elo, K=32, start 1000) and 20 XP per win. A ghost that wins gets +K/2; a ghost that loses loses only K/4, so being offline isn't punished. |
| **Practice** | Any approved fan's ghost, or a boss tier you've already cleared | unlimited | nothing; replay only |

- **Matchmaking (ranked):** pick a random eligible ghost with rating within ±150, widening by 50 per empty search. Exclude yourself, accounts younger than 24h, users with a non-approved display name, and any opponent you've already fought 3 times today. If the ghost owner no longer owns one of the lineup's cards, mark the lineup stale, notify the owner ("Your defense lineup needs a card") and pick another.
- **Ladder** rows reset each season (weekly by default). `/leaderboard` gets an additive `battlers` top 10; the collector score (1/3/10/25) is unchanged.
- **Anti-abuse:** no stakes, so there is nothing to farm for value. XP, badges and tokens can't be traded. Win-trading is blunted by the per-opponent daily limit and by ghosts only losing K/4. All reward writes are idempotent.

### 2c. Server-authoritative resolution

The flow is one request with one transaction. There is no start/finish pair a client could abandon.

```
POST /battles {mode, tier?, instanceIds[3], idempotencyKey}
 tx:
  lockUser(me)                                   -- serializes my battles: caps + idempotency
  replay? SELECT battle WHERE challenger=me AND idempotency_key=k  → return it unchanged
  SELECT card_instances … WHERE id=ANY($ids) AND burned_at IS NULL ORDER BY id FOR SHARE
     → all 3 owned by me, distinct, (ranked) cost ≤ 9        -- FOR SHARE blocks a concurrent trade swap
  derive stats (shared pure fn) + read card_stats.hype → snapshot
  opponent: vault boss row (today, tier)  |  ghost lineup (FOR SHARE on its instances; stale → next)
  seed = crypto.randomBytes(16); rulesVersion = BATTLE_RULES.version
  log = resolveBattle(mySnapshot, oppSnapshot, seed, rules)   -- pure, deterministic
  INSERT battles (+ 3 battle_rounds)
  ranked: SELECT ladder rows for both users ORDER BY user_id FOR UPDATE → Elo update
  rewards: INSERT … idempotency_key = 'battle:<id>:<kind>'  (XP, badge, token; never ledger)
 → 201 {battle}   (seed revealed in the response; client animates the log)
```

- **The resolver is a pure TypeScript function**, proposed for `packages/shared/src/battle.ts` (lead-owned) so the client can **re-run it as a "Verify replay" check**: same seed plus same snapshots gives the same log.
- **RNG:** xoshiro128** seeded via splitmix32 from the 16-byte seed. It is pure JS, so the browser and Node produce identical streams. `crypto.randomBytes` supplies the seed, the same CSPRNG source pulls use.
- **Rules versioning:** `BATTLE_RULES` (constants, role table, era table) carries a version that is stored on every battle and published at `GET /battle/rules`, the same way pack odds are published.
- **Cards are not locked by battles.** A card in an open trade or listing can still fight, because battles don't move ownership. Only Fuse and the defense lineup interact with locks: Fuse refuses defense-lineup cards, and a defense lineup goes stale when one of its cards is traded away.
- **Error codes:** existing ones only. `VALIDATION` for a bad lineup, cost over 9 or a duplicate. `NOT_FOUND` when you don't own a card. `CONFLICT` when no attempts are left today, no opponent is found or a target is sold out. `CARD_LOCKED` when a Fuse input is reserved.

### 2d. Balance: worked example (real seed cards)

**You:** Rain / OG Era 3 (epic), Apex / OG Era 2 (rare), Banks / OG Era 1 (common). Cost 6. Synergies: Era Stack +6 and Full Squad +4, total **+10**.
**Ghost:** Apex / Creators 7 (epic), Banks / Creators 6 (rare), Rug / Esports Moments 5 (common). Cost 6. Synergies: Era Pair +3 and Full Squad +4, total **+7**.

The rolls below are illustrative, from the prototype with seed `0000000f66617a652d64656d6f`. The prototype's RNG is HMAC-based, so the production xoshiro RNG will give different numbers for the same seed.

| Round (pts) | Call | You | Ghost | Result |
|---|---|---|---|---|
| 1 Opener (1) | POWER | Rain 64 + 10 + swing 20 = **94** | Apex 74 + 7 + 29 = **110** | Ghost wins, 0–1 |
| 2 Mid (1) | STYLE | Apex 44 + 10 + 33 + **TRICKSHOT 12** = **99** | Banks 57 + 7 + 40 = **104** | Ghost wins, 0–2 |
| 3 Closer (2) | CLUTCH | Banks 21 + 10 + 50 + TRICKSHOT 12 + **CLUTCH 9** = **102** | Rug 25 + 7 + 7 = **39** | You win, 2–2 |

Points are tied 2–2, so total score decides: 295 against 253, and **you win**. Over 20,000 seeds this exact matchup goes 56% to 44% your way. The edge comes from your better synergy. That's the intent: equal-cost squads should be close, and lineup building should decide close fights.

**Win-rate sanity** (SWING 60, random cards of each rarity):

| Matchup | Cost | Win % (A) |
|---|---|---|
| C/C/C vs C/C/C | 3 v 3 | 50 |
| R/R/R vs C/C/C | 6 v 3 | 84 |
| E/E/E vs R/R/R | 9 v 6 | 84 |
| L/L/L vs E/E/E | 12 v 9 | 81 |
| L/L/L vs C/C/C | 12 v 3 | ~100 |
| E/R/C vs R/R/R | 6 v 6 | 42 |
| L/R/C vs E/E/C | 7 v 7 | 50 |
| L/E/R vs E/E/E | 9 v 9 | 41 |
| L/L/C vs E/E/E | 9 v 9 | 36 (stacking legends with filler is a trap) |
| Era Stack R/R/R vs random R/R/R | 6 v 6 | 57 |
| Single lane: one tier higher | | 72–73 |
| Single lane: legendary vs common | | 96 |

Rarity matters: a squad one tier higher wins about 83% of the time. It doesn't guarantee a win at equal cost, where results stay between 36% and 50%, so the squad cap plus matchmaking keep ranked fair.

**Vault tiers against a typical starter** (best set-stacked lineup):

| Lineup | Rookie 20 | Pro 40 | Elite 60 | Legend 78 |
|---|---|---|---|---|
| R/C/C (after one pack) | 60% | 18% | 2% | 0% |
| R/R/C | 72% | 24% | 4% | 0% |
| E/R/R | 90% | 55% | 16% | 3% |
| L/E/R | 96% | 75% | 30% | 6% |

A first-time demo player can beat Rookie. Pro and above are goals that push players toward packs and trades.

**Tunable constants (`BATTLE_RULES` v1):**

```
SWING=60, TRICKSHOT=+12, TRICKSHOT_DIV=400,
CLUTCH_BASE=6, CLUTCH_K=0.3, ROUND_POINTS=[1,1,2],
ERA_STACK=6, ERA_PAIR=3, FULL_SQUAD=4,
SQUAD_CAP=9, COST={1,2,3,4},
SERIAL_PERK={#1:+3, #2-10:+1},
VAULT_TIERS=[20,40,60,78], VAULT_ATTEMPTS=3,
RANKED_REWARDED_PER_DAY=10, ELO_K=32,
GHOST_LOSS_FACTOR=0.25, SAME_OPPONENT_PER_DAY=3
```

How each knob moves balance:
- **Raising SWING** makes upsets more likely. At 75, a one-tier gap drops to about 80%.
- **Raising CLUTCH_K** makes hype, and so the simulated engagement, matter more.
- **Raising ERA_STACK** rewards set completion more.

---

## 3. Trading improvements (on top of what exists; still no coins, no cash-out)

1. **Value Index (VI) meter: advisory only, never shown as coins.**
   - Formula: `VI = rarityBase × supplyF × serialF × hypeF`.
     - `rarityBase` = RARITY_SCORE × 10, giving 10 / 30 / 100 / 250.
     - `supplyF` = 1.25 if the card is capped, 1.5 if it's sold out, otherwise 1.0.
     - `serialF` = 2.0 for #1, 1.3 for #2–10, otherwise 1.0.
     - `hypeF` = `1 + hype/200`.
     - A demand factor (wishlists and open offers) comes in v2.
   - Example: Rain / OG Era 8 #3 is 250 × 1.25 × 1.3 = **406 VI**. Three ordinary rares (90 VI) for Apex / OG Era 7 (capped epic, 125 VI) gives a ratio of 0.72, which reads "You receive more".
   - Bands: within ±25% is **Fair**, 25–100% is **Generous / Lopsided**, and above 4× gets a **Check this trade** warning.
   - Where it shows: the compose step of direct trades and of marketplace offers.
   - Copy: "Value Index is a guide based on rarity, supply, serial and simulated hype. It is not a price and has no coin value."
2. **Lineup-driven trade suggestions.**
   - The lineup builder shows what you're missing, for example "1 more OG Era card for Era Stack (+6)" or "A Closer with CLUTCH 70+".
   - Each suggestion deep-links to marketplace search pre-filled with set and rarity, and to open listings that fill the gap.
3. **Set completion goals.**
   - `GET /me/sets` returns owned / total per set and the list of missing cards.
   - Completing a set earns a badge and a profile frame. Optional: completing the campaign set unlocks that campaign's Vault Legend tier.
   - A "Wanted" flag on a missing card notifies you when one gets listed (notification kind `wanted_listed`).
4. **Cooldowns and anti-wash rules.** These matter because collector rank is computed from owned cards, so alt accounts can feed cards to a main account to inflate it.
   - A card received in a trade can't be re-offered for `TRADE_COOLDOWN` (30 min in production, 2 min with `DEMO_MODE`). This needs a new `card_instances.last_traded_at`, because `acquired_at` is also set at mint.
   - At most 3 accepted trades per user pair per 24h.
   - One-sided trades (gifts or requests with nothing in return) need a sender account at least 24h old that has opened at least 1 pack.
   - VI ratio above 4× or a gift writes an `audit_log` entry (`trade_flagged`) that shows in Trust & Operations. Flags don't block the trade.
5. **Notifications.** Server-side notifications already exist for trades and the market. Add new kinds: `battle_defended` (your ghost won or lost; batched as at most 1 per hour), `lineup_stale`, `vault_new` (daily), `set_complete`, `fuse_done` and `wanted_listed`. `notifications.kind` is free text, so no migration is needed for these.

---

## 4. Where it lives in the web page

New main-nav tab **Battle**, between Collection and Trades. It has sub-tabs **Vault / Ranked / Ladder / Defense**.

1. **Lineup builder** (shared by every mode).
   - Three slots: Opener, Mid and Closer (worth 2 points).
   - A drawer of your collection sorted by the stat you pick, with stat bars on each card.
   - A live **Squad Cost meter** (x/9; red when over the cap) and synergy chips ("ERA STACK +6", "FULL SQUAD +4") that light up as you fill slots.
   - An "Auto-pick best" button and a "What would help" list (§3.2).
2. **Vault screen.**
   - Today's boss as one large card: name, source campaign or moment, "DEMO" label, the boss's 3 cards with their stats, and 4 tier pills with attempts left and cleared ticks.
   - Fight button.
3. **Ranked / matchmaking.**
   - "Find opponent" shows a face-down ghost card back with the opponent's display name and rating. Their lineup is hidden until the fight, so there's no counter-picking.
   - Then Fight.
4. **Battle replay** (full-screen, reusing `pack-fx`: the `.pack-cinema` tokens, `GlitchOverlay`, `DecodeText`, `trackSpotlight`).
   - Two rows of cards flip in by lane, with rarity glow from the existing `fx-r-*` knobs.
   - Each round: the stat call decodes in, both scores count up, then TRICKSHOT ray burst, CLUTCH glitch, and the lane winner slams forward in FaZe red.
   - The end screen shows points, totals, rewards and rating delta, with Skip, Rematch (new seed), Share replay link (v2) and **Verify replay**, which re-runs the shared resolver in the browser.
   - With `prefers-reduced-motion`, a static round table replaces the animation.
5. **Card detail** (existing modal): four stat bars plus role and era badges, a serial perk badge, "HYPE · SIMULATED", Cost, Value Index, this card's battle record and a "Use in lineup" button.
6. **Collection:**
   - Per-set progress bar (11/14) with missing-card silhouettes and a "Find in marketplace" link.
   - A **Fuse** button on any set+rarity group with 5 or more spare duplicates. It opens a confirm sheet listing the 5 burned copies, the chosen target, and the text "Burning is permanent".
7. **Trades:** the VI meter in both compose flows, and a cooldown chip on freshly traded cards.
8. **Leaderboard:** a third column, **LADDER / SEASON n**, next to Top Collectors and Trending.
9. **Control Room** (lead-owned UI):
   - Campaign detail: **Make Vault boss for <date>**.
   - A Battle Health panel: battles per day, win rate by rarity, top cards by win rate (a balance watch), and token opens kept separate from coin opens in Revenue.
   - Content ops (D): a `member_profiles` role editor.

### 4c. Clip Lab → Moment cards

Clips captured or approved through Designs A/B become art. The Studio campaign then marks one card per drop as `kind = 'moment'` and gives it **one ability from a fixed list** (no free-form logic). Rights and moderation gates are the same as for campaigns.

| Ability | Effect (engine-level, versioned) | Fits clips that show… |
|---|---|---|
| **Highlight(stat)** | +8 when the round's stat call equals the clip's tag (e.g. STYLE for a trickshot clip) | a specific skill |
| **Instant Replay** | once per battle, if its round is lost, re-roll its swing and keep the higher roll (seeded, logged) | a comeback or reaction |
| **Fresh Moment** | for 72h after the drop launches, HYPE = live hype (not the average with base) | a breaking or live moment |

- The Moment card's art is the face-crop from Design B.
- The card detail shows a "From the clip" source line (the archive or clip reference already stored for the rights register).
- The **daily Vault boss can be that moment**, and beating it gives a token for that campaign's pack. This feeds the existing campaign metrics (pulls, collectors, attribution).

---

## 5. Server and data design

### 5a. Migration `services/api/migrations/008_game.sql` (owner: A; schema reviewed by the lead)

```sql
CREATE TABLE member_profiles (faze_member text PRIMARY KEY, role text NOT NULL CHECK (role IN ('founder','og','creator','pro')),
  updated_at timestamptz NOT NULL DEFAULT now(), demo boolean NOT NULL DEFAULT false);

CREATE TABLE vault_bosses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), on_date date NOT NULL UNIQUE, name text NOT NULL,
  campaign_id uuid REFERENCES campaigns(id), moment_id uuid REFERENCES archive_moments(id),
  lineup jsonb NOT NULL,            -- 3 boss cards: name, art_url, member label, base stat line
  reward_pack_id uuid REFERENCES packs(id), rules_version int NOT NULL, created_by uuid REFERENCES users(id),
  demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE lineups (user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK (kind IN ('defense')),
  instance_ids uuid[] NOT NULL CHECK (cardinality(instance_ids)=3), stale boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, kind));

CREATE TABLE battles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('vault','ranked','practice')), tier int,
  challenger_id uuid NOT NULL REFERENCES users(id), opponent_user_id uuid REFERENCES users(id), boss_id uuid REFERENCES vault_bosses(id),
  challenger_lineup jsonb NOT NULL, opponent_lineup jsonb NOT NULL,      -- stat snapshots incl. instance ids + hype used
  seed bytea NOT NULL, rules_version int NOT NULL,
  winner text NOT NULL CHECK (winner IN ('challenger','opponent')), points int[] NOT NULL, totals int[] NOT NULL,
  rating_delta int, rewards jsonb NOT NULL DEFAULT '[]', idempotency_key text NOT NULL,
  demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenger_id, idempotency_key), CHECK ((opponent_user_id IS NULL) <> (boss_id IS NULL)));
CREATE INDEX battles_by_user_day ON battles (challenger_id, created_at DESC);

CREATE TABLE battle_rounds (battle_id uuid NOT NULL REFERENCES battles(id), round_no int NOT NULL CHECK (round_no BETWEEN 1 AND 3),
  stat text NOT NULL, a_instance_id uuid, b_ref text NOT NULL, a_score int NOT NULL, b_score int NOT NULL,
  events jsonb NOT NULL,            -- [{side, kind:'swing'|'trickshot'|'clutch'|'ability', value}]
  PRIMARY KEY (battle_id, round_no));

CREATE TABLE ladder (user_id uuid NOT NULL REFERENCES users(id), season text NOT NULL, rating int NOT NULL DEFAULT 1000,
  wins int NOT NULL DEFAULT 0, losses int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, season));

CREATE TABLE rewards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('xp','badge')), amount int NOT NULL DEFAULT 0, badge text,
  battle_id uuid REFERENCES battles(id), idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
                                     -- append-only, like ledger; XP = SUM(amount)

CREATE TABLE pack_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  pack_id uuid NOT NULL REFERENCES packs(id), source_battle_id uuid REFERENCES battles(id),
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used','expired')), pull_id uuid REFERENCES pulls(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (source_battle_id));   -- v2

CREATE TABLE crafting_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  burned_instance_ids uuid[] NOT NULL, target_card_id uuid NOT NULL REFERENCES cards(id), result_instance_id uuid NOT NULL REFERENCES card_instances(id),
  rules_version int NOT NULL, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, idempotency_key)); -- v2

ALTER TABLE card_instances ADD COLUMN burned_at timestamptz, ADD COLUMN last_traded_at timestamptz;        -- v2
ALTER TABLE cards ADD COLUMN kind text NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','moment')),
                  ADD COLUMN ability jsonb;                                                              -- v2 (Moment cards)
ALTER TABLE pulls ADD COLUMN paid_with text NOT NULL DEFAULT 'coins' CHECK (paid_with IN ('coins','token')); -- v2
```

For the demo slice, ship only `member_profiles`, `vault_bosses`, `battles`, `battle_rounds` and `rewards`. Everything marked v2 goes in a later migration (009).

### 5b. Endpoints (contract v1.9; additive, so existing clients keep working). **Lead must approve.**

| Method | Path | Body → Response | Phase |
|---|---|---|---|
| GET | `/battle/rules` | → `{rulesVersion, constants, roles, eras, costs}` (published, like odds) | demo |
| GET | `/cards/:id` | adds `battleStats: {power, clutch, style, hype, role, era, cost}` | demo |
| GET | `/me/cards` | each instance adds `battleStats` and `perk` (`first_edition` \| `low_serial` \| null) | demo |
| GET | `/vault/today` | → `{boss: {id, name, source, lineup, demo}, tiers: [{tier, difficulty, rewards, attemptsLeft, cleared}]}` | demo |
| POST | `/battles` | `{mode: 'vault'\|'ranked'\|'practice', tier?, instanceIds[3], idempotencyKey}` → `201 {battle}` (rounds, seed hex, rulesVersion, winner, points, totals, rewards, ratingDelta). A replayed key returns the same battle. | demo (vault) / v2 |
| GET | `/battles/:id` · `/me/battles?limit=` | → `{battle}` / `{battles}`; participants only (public replays are an open decision) | demo |
| GET / PUT | `/me/lineups/defense` | `{instanceIds[3]}` → `{lineup}` | v2 |
| GET | `/ladder?season=` | → `{season, entries: [{user, rating, wins, losses}]}`; `/leaderboard` adds `battlers` | v2 |
| GET | `/me/progress` | → `{xp, level, badges, packTokens}` | demo (xp/badges) |
| POST | `/packs/:id/open` | also accepts `{idempotencyKey, packTokenId}`: no ledger debit, `pulls.paid_with='token'`, same published odds | v2 |
| POST | `/craft` | `{burnInstanceIds[5], targetCardId, idempotencyKey}` → `{crafted: CardInstance, burnedIds}` | v2 |
| GET | `/me/sets` | → `{sets: [{set, owned, total, missing: [Card], complete}]}` | v2 |
| POST | `/trades/value` | `{offeredInstanceIds, requestedInstanceIds}` → `{offered, requested, ratio, verdict, flags}` | v1.5 |
| POST | `/admin/control/vault` | `{onDate, campaignId?, momentId?, name, rewardPackId?}` → `201 {boss}` (audit-logged) | demo (or seed-only) |
| GET | `/admin/control/battles` | → `{perDay, winRateByRarity, topCards, tokenOpens}` | v2 |

If no boss row exists for today, `/vault/today` **auto-builds** one from the most recently launched live campaign set (its top 3 cards by rarity, stats overridden to the tier lines), falling back to a seeded "FaZe Vault Keeper" boss. The demo can't come up empty.

### 5c. Transactions, locks and idempotency

**Lock order** everywhere: user row (`lockUser`), then `card_instances` (`ORDER BY id`), then `cards` rows (`ORDER BY id`, only Fuse and token opens need these), then `ladder` (`ORDER BY user_id`). Battles take only `FOR SHARE` on instances, so they never block each other, and a trade accept that runs at the same moment either goes first (the battle then sees the new owner and fails `NOT_FOUND`) or waits for the battle to finish.

**Idempotency:**
- Battles use `UNIQUE(challenger_id, idempotency_key)`.
- Rewards use `battle:<battleId>:xp|badge|token`.
- Fuse uses `craft:<userId>:<key>`.
- Token opens reuse the pack-open replay path (`pack_open:<user>:<key>`). The token is marked `used` in the same transaction.

**Daily caps** (vault attempts, rewarded ranked battles) are counted from `battles` inside the transaction, after `lockUser`, so two parallel requests can't both take the last attempt.

**Ledger and leaderboard reuse:**
- Battles never write to `ledger`, so the `LedgerReason` enum doesn't change.
- XP lives in `rewards`, which follows the same append-only, sum-based, idempotent pattern.
- The collector score is unchanged apart from filtering out `burned_at`; the ladder is a separate column.

**Tests (A):**
- Same seed and snapshots give an identical log (and a golden-log fixture).
- A replayed key returns the same battle with no second reward.
- Not owning a card, a duplicate instance or cost over 9 fails `VALIDATION`/`NOT_FOUND`.
- Parallel last-attempt requests: exactly one succeeds.
- A trade accept racing a battle on the same card leaves both consistent.
- Fuse refuses locked cards and last copies.
- Burned cards are gone from the collection and the leaderboard.

---

## 6. Phasing

### Demo-day slice (about 3–4 hours, parallel)

The goal is one judge-visible beat after Trades or Leaderboard: *"Your cards can fight."* The judge picks 3 cards, takes on today's Vault boss (built from the live campaign), watches a 20-second replay with a Trickshot and a Clutch comeback, earns XP, and opens card detail to see the stats. Then an admin hype spike raises Rain's HYPE and Clutch bonus live.

| Who | Work | Est. |
|---|---|---|
| **Lead** @Abhijith-utla | Approve contract v1.9 (demo rows only); add `BattleStats`, `Battle`, `VaultToday` zod types, `BATTLE_RULES` v1 and the pure `deriveStats` / `resolveBattle` / xoshiro RNG to `packages/shared` (or hand that file to Tush). | 45 min |
| **Tush** @toosh-legacy | `008_game.sql` (5 tables); `GET /battle/rules`, `GET /vault/today` (auto-build fallback), `POST /battles` (vault only), `GET /battles/:id`, `/me/battles`, `/me/progress`; `battleStats` on `/cards/:id` and `/me/cards`; tests listed in §5c. | 2.5–3 h |
| **Jaideep** @Jaideepo7 | Battle tab: lineup builder (3 slots, auto-pick, synergy chips), Vault boss panel, replay animation on `pack-fx` (DecodeText stat calls, GlitchOverlay on Clutch, ray burst on Trickshot, reduced-motion table), stat bars in card detail. | 3–3.5 h |
| **Keshav** @tanejakeshav | Seed `member_profiles` (5 members, `demo`), one seeded demo Vault boss for demo day, and a check that the engagement spike moves hype on a battle-visible card. | 30 min |

Cut from the slice: ranked/ghosts, ladder, pack tokens, Fuse, VI meter, set progress and Moment abilities. If there's an hour left, add the **VI meter**, computed client-side from `battleStats`, rarity, serial and hype. It's cheap and visible in the Trades demo.

### v2 (roadmap)

1. **Ranked:** defense lineups, ghost matchmaking, ladder and seasons, the `battlers` leaderboard and `battle_defended` notifications.
2. **Rewards:** pack tokens (the Vault Pro+ first clear gives the campaign pack), opened via `packTokenId`, with Revenue showing token opens separately.
3. **Collection:** Fuse/crafting with `burned_at`, `crafting_log` and the Fuse sheet; set completion, wanted lists and `wanted_listed`.
4. **Trading safety:** `/trades/value` server-side, cooldown (`last_traded_at`), the pair limit and gift rules, and `trade_flagged` in Trust & Operations.
5. **Moment cards:** `cards.kind/ability`, Studio ability picker, Clip Lab art, and moment-as-Vault-boss.
6. **Ops and sharing:** Control Room Battle Health; public shareable replays (approved names only); a cosmetic profile frame shop. Cosmetics are earned through XP and never bought with coins until the lead decides otherwise.

---

## 7. Board asks (copy-paste)

- `[Tush's Claude] @Abhijith-utla` Proposal "Game logic v1" (battles, Vault PvE, stats). It's additive: contract v1.9 adds `GET /battle/rules`, `GET /vault/today`, `POST /battles` (vault), `GET /battles/:id`, `/me/battles`, `/me/progress`, and `battleStats` on `/cards/:id` and `/me/cards`. No ledger change, no coin rewards, cards never at stake. Please approve, and decide: (1) does the shared resolver go in `packages/shared/src/battle.ts` (yours) or can I own it? (2) migration number 008 (005 Scout, 006 sponsors, 007 face-art). Design doc to follow.
- `[Tush's Claude] @Jaideepo7` Once v1.9 lands: Battle tab (lineup builder + Vault + replay on pack-fx). `POST /battles` returns the full round log and you only animate it. `resolveBattle` in shared lets you add a "Verify replay" button. Stub shapes are in the doc §5b.
- `[Tush's Claude] @tanejakeshav` Need `member_profiles` seed rows in `content/seed/` (Apex founder, Rain og, Banks/Adapt/Rug creator, all demo; please confirm the roles) and one demo Vault boss for demo day. Also please check the engagement spike updates `card_stats.hype` within ~10 s, since Clutch reads it.
- `[Tush's Claude] @all` Battles: no stakes, no coin payouts, rewards fixed and published, server-seeded and logged with rules version. Same trust story as pulls.

---

## 8. Open decisions (for the user / lead)

1. **Member roles and likeness.** Are the roles (Apex founder, Rain OG, Banks/Adapt/Rug creator) accurate, and should members who have left FaZe appear as battle "fighters" at all? Rights already gate campaigns, and this is a content/brand call.
2. **Squad cap 9** in ranked. Alternatives are no cap with matchmaking by lineup strength only, or a different cap.
3. **Pack Token as a battle reward.** We think a free, earned pack with published odds and no purchase stays clear of gambling framing. The lead should still confirm, or keep rewards XP and cosmetics only.
4. **Fuse target.** Player-chosen (proposed, deterministic) or random within the next rarity (more exciting, but a random reward from burning value is closer to loot-box territory).
5. **Trade cooldown length**, and whether cards received as **gifts** should count toward collector score.
6. **Public replays.** Should anyone with the link see `/battles/:id`, or participants only?
7. **Ghost losses** at K/4 (protects offline players but slightly inflates ratings), or symmetric Elo.
8. **Where `resolveBattle` lives** (shared, lead-owned, vs api-only with the client trusting the log). Shared enables "Verify replay", which is a nice trust moment for judges.
