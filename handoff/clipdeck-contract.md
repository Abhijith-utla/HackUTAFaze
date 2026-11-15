# ClipDeck build contract (branch `toosh`)

Source of truth for product rules: `C:\Users\tusha\Downloads\ClipDeck — Product & Build Spec.pdf` (user's spec).
This file pins the exact API shapes so parallel agents (API, content, fan UI, admin UI) stay compatible.
Schema: `services/api/migrations/009_clipdeck.sql` (already committed). Read it first. Do NOT create other migrations
except where your section says so; number new ones from 010 upward ONLY if listed.

## Conventions (match the repo)
- Fastify + pg, `requireUser(req)` / `requireAdmin`, `tx()` from src/db.ts, errors via `fail(CODE, message)` from src/errors.ts
  → `{error:{code,message}}`. Ledger column is `amount` (not delta); credits go through the existing ledger helper
  (find it in src — e.g. postEntry) with an idempotency key; balance = SUM. Never edit a balance.
- Randomness: `crypto.randomInt`. Odds in per-mille integers.
- Art URLs relative (`/art/…`, `/demo-art/…`); client resolves with `art()`.
- Card JSON = existing `toCard` mapper shape PLUS `{ lore, era:{id,name}|null, frame, clipUrl|null, clipperHandle|null, isLiveMoment }`
  (extend the mapper once in src/mappers.ts; agent A owns that edit).
- Everything demo is labelled `demo: true`.

## Economy constants (spec "Game economy"; put in `services/api/src/clipdeck/economy.ts`, exported, agent A)
- ODDS per-mille: common 700, rare 220, epic 70, legendary 10. ODDS_VERSION = 1. PITY = 30 (force Legendary on 30th daily pack without one).
- Daily pack: 5 cards; slots 1–4 normal odds, slot 5 rare-or-better (700 + randomInt(300) in the same table).
- Streak coins day1..7: [10,15,20,25,30,40,50]; day 8+ stays 50; missing a UTC day resets to 1. Awarded once per UTC day by POST /me/checkin (idempotency `streak:<user>:<day>`).
- Dust: common 5, rare 20, epic 60, legendary 200 (only if user owns ≥2 copies of that card; dusts the given instance; instance deleted? NO — mark it burned: delete is irreversible; use DELETE only if no trade/listing lock; record in ledger ref_id=instance id).
- Set complete: 500 coins once per (user,set) (idempotency `setcomplete:<user>:<set>`), plus cosmetic `skin:<eraId>` granted (acquired_via set_complete).
- Clip approved as card: 300 coins to submitter (idempotency `clipcard:<clipId>`), and submitter gets copy #1 (acquired_via 'clipper').
- Live Moment claim: 25 coins (`drop:<dropId>:<user>`).
- Shop: pick-1-of-3 = 400 coins; card frame = 600; KAM era skin = 1200. SKUs: `pick:<setId>`, `frame:<frameId>` (frames: gold, neon, camo-red, vhs, holo), `skin:<eraId>` (mw2, house, streamer, esports).

## API — agent A ("ClipDeck API core": daily, binder, dust, streak, odds, share, cards)
- `GET /odds` (public) → `{version:1, tiers:[{rarity, perMille, percent}], dailyPack:{slots:5, guaranteedSlot:5, guaranteed:'rare_or_better'}, pity:{packs:30}, rules:["Free packs only are random","Everything paid is shown before buying"]}`
- `GET /packs/daily` (user) → `{available:boolean, day:'YYYY-MM-DD', resetsAt:iso, pityCount:int, pityRemaining:int, lastOpen?:{instanceIds, tiers}}`
- `POST /packs/daily/open` (user) → `201 {day, cards:[{instance:{id,serial,acquiredVia:'daily'}, card:Card, slot:1..5, guaranteed:boolean, pity:boolean}], pityCount, setProgress:[{setId, owned, total}]}`; second call same UTC day → 409 `ALREADY_OPENED`. Pool = cards in LIVE sets with `is_live_moment=false` and respecting max_supply (reuse existing serial-assignment logic from src/pack-mint.ts or packs route). If a tier has no cards, fall back to the nearest lower tier then higher. Also checks set completion inside the same tx and pays set-complete rewards.
- `POST /me/checkin` (user) → `{streakDays, coinsAwarded, alreadyCheckedIn:boolean, day}`; `GET /me` gains `streakDays, pityCount, equippedFrame, equippedSkin` (extend existing /me response; keep old fields).
- `GET /binder` (user) → `{eras:[{id,name,starts,ends, sets:[{id,name,status, total, owned, complete, rewardClaimed, cards:[{card:Card, owned:int, instances:[{id,serial,acquiredVia,tradableAfter}]}]}]}]}` (missing cards included with owned=0 so the client shows silhouettes; only live sets + sets the user owns cards from).
- `GET /cards/:id` keep existing; add lore/era fields via mapper.
- `POST /cards/instances/:instanceId/dust` (user) → `{coins, dusted:{instanceId, cardId, rarity}, balance}`; 409 `NOT_DUPLICATE` if <2 copies; 409 `CARD_LOCKED` if in trade/listing/offer.
- `GET /cards/:id/share.png` (public) → 1200×630 PNG share image (sharp; art + title + era + rarity + "FΛZE VAULT"), cache 1h. If sharp missing → 503.
- New error codes: ALREADY_OPENED, NOT_DUPLICATE (add to errors.ts status map; 409).

## API — agent B ("ClipDeck API live+shop+clips+admin")
- `GET /drops/live` (public; user-aware if cookie) → `{drop: null | {id, card:Card, startsAt, endsAt, secondsLeft, claimCount, source, claimed:boolean, mySerial?:int}}` (most recent open window).
- `POST /drops/:id/claim` (user) → `201 {serial, instance:{id,serial}, coinsAwarded:25, claimCount}`; errors 409 `ALREADY_CLAIMED`, 410 `DROP_EXPIRED` (or 409; add codes). Serial in claim order via `UPDATE live_drops SET claim_count=claim_count+1 … RETURNING` (spec §5). Instance `acquired_via='drop'`, `tradable_after = now()+7 days`. ALSO enforce tradable_after in POST /trades and marketplace listing/offer (409 `CARD_LOCKED` with message "Live Moment cards trade after 7 days").
  Serial collision: cards(card_id, serial) is UNIQUE — a drop card must be `is_live_moment=true` (never in pack pool); if the card already has instances, offset serials after MAX(serial) for that card.
- `POST /admin/drops` (admin) `{cardId, minutes=10, source:'simulated'}` → `201 {drop}`; marks card is_live_moment; audit_log row. `GET /admin/drops` list with claims. A drop closes when ends_at passes: `edition_size` = claim_count — set lazily on read and by the worker job `close_drop` if you add it (optional).
- `POST /submissions/clips` (user) `{url (https, youtube/twitch/x/tiktok/kick hosts), eraId, title, description≤280, clipperConfirmed:true}` → `201 {clip}`; 409 `DUPLICATE_URL`, 429 `RATE_LIMITED` (3/user/UTC day), 400 if clipperConfirmed false; banned-word auto_flags (reuse worker/moderation word list approach in API, simple list). `GET /me/submissions/clips` → `{clips:[…status, rejectReason, cardId?]}`.
- `GET /admin/clips?status=` (admin), `POST /admin/clips` (archive clip: url, eraId, title, description, views, likes, comments, capturedAt), `POST /admin/clips/:id/review {decision:'approve'|'reject', reason?}`.
- `POST /admin/clips/:id/card` (admin) `{setId, title, lore, artUrl, frame?, rarity?(override), isLiveMoment?}` → creates a card in that set linked to the clip; rarity from era percentile unless override (log in rarity_overrides with staff id); if the clip is a fan clip: pays 300 coins + grants copy #1 (acquired_via 'clipper', serial 1) to the submitter, sets clipper_handle = submitter display name (approved names only, else 'collector').
- `POST /admin/rarity/recompute {eraId?}` → spec §1 percentile SQL over approved clips (score = views + 20*likes + 50*comments), updates cards where NOT rarity_override; returns changes. `POST /admin/cards/:id/rarity {rarity, reason}` override + log.
- `GET /shop` (public) → `{items:[{sku, kind:'pick'|'frame'|'skin', name, description, priceCoins, owned:boolean(if user), setId?, eraId?}], rules:[…]}` (pick items = one per live set).
- `POST /shop/pick/:setId` (user) `{idempotencyKey}` → spends 400 (ledger reason shop_pick, key `pick:<offerId>`) and returns `201 {offer:{id, expiresAt, cards:[Card×3 distinct, weighted by nothing — uniform from set]}}`; same key → same offer. 402/409 `INSUFFICIENT_COINS`.
- `POST /shop/pick/:offerId/choose {cardId}` → `{instance, card}` (acquired_via 'shop_pick'); 409 `OFFER_EXPIRED` (15 min) / already chosen → returns same result.
- `POST /shop/cosmetics/:sku/buy` → spends coins, inserts user_cosmetics; 409 `ALREADY_OWNED`. `POST /me/equip {frame?:sku|null, skin?:sku|null}` (must own).
- `GET /admin/economy` → odds, ledger totals by reason, coins outstanding, top earners, accounts flagged (many signups same day pattern is fine as a heuristic: >3 accounts created within 10 min with same email domain).
- Register routes in app.ts with ONE line each (agent A and B each add their own; expect a trivial merge).

## Content — agent C (seed)
4 eras × ~20 = 80 card definitions from PUBLIC FaZe moments (moments, NOT people as the subject), marked demo. For each: title, eraId, setName (`MW2 Trickshots`, `FaZe House`, `Streamer Era`, `Esports`), lore (2–3 lines, KAM the Killcam's voice, grounded in the public description, NO invented quotes from real people), clip url (public, real if you know it, else leave a clearly-labelled placeholder `https://example.invalid/demo/<slug>` — never invent fake real-looking URLs), approximate engagement (views/likes/comments, labelled demo/approx), fazeMember (the member most associated, used only as metadata), and generated era-framed SVG art (no faces/likeness: abstract scene illustration — e.g., scope reticle + trajectory for a trickshot, house silhouette, controller/trophy icons) in content/seed/clipdeck/art/*.svg. Seed creates eras' sets (live, era_id set), clips (source archive, approved), cards linked to clips with lore, then runs the percentile rarity (same formula) so rarity = era percentile. Keep existing seed sets working (or retire them as 'retired' so the pool is the ClipDeck sets — choose retire, keep their instances valid).

## Fan UI — agent D (apps/client)
Screens per spec (Today home, Daily pack w/ KAM reveal reactions, Binder w/ silhouettes + progress + set-complete toast, Card detail w/ lore + Share (opens /cards/:id/share.png, Web Share API fallback), Live Now banner + countdown + Claim, Shop (pick-1-of-3 reveal-all-then-choose, frames, KAM skins, equip), Submit a clip + my submissions, Odds page, streak check-in, Dust button on duplicates). Keep Battle tab, Trades, Leaderboard, /watch. KAM the Killcam = original mascot (camera-robot character) drawn as inline SVG (no third-party IP), with reaction states (idle, hype for epic, losing-it for legendary). Equipped frame/skin visibly applied (card frame class, KAM skin color). Paid random packs: per spec "nothing you pay for is random" — the Store tab becomes "Shop"; existing SOL/coin random pack purchase UI is moved behind a clearly labelled "Classic packs (legacy demo)" section (do not delete code; product decision pending).

## Admin UI — agent E (apps/client/app/admin/control/**)
New pages in the unified Control Room shell (add NAV entries in `_components/ui.tsx` GROUPS): Clips (list, add archive clip with engagement, review fan submissions with reason, "Make card" form → POST /admin/clips/:id/card incl. rarity override + reason, art from Clip Lab / upload), Live Moments (pick card, minutes, Fire drop; live countdown + claim count; history), Economy (GET /admin/economy, odds, recompute rarity button). Reuse the shell's components/styles (control.css, `.admin-root` scope).
