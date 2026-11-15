# FaZe Collector Cards: business proposition

HackUTA 2026, FaZe track. Labels used throughout: **[built]** works in the demo today. **[demo/simulated]** is built but runs on demo or simulated data. **[proposed]** is not built.

## 1. Problem
FaZe's audience followed individual creators, not the org.
- Reach is big: about 500M social reach in 2022, 80% aged 13–34.
- That reach lives on other companies' platforms, so FaZe does not own the fan relationship or the fan data.
- Revenue is concentrated and depends on buzz. About 22% of 2021 revenue came from one creator, and revenue fell about 30% in H1 2023 as buzz cooled. *Verify both figures against Business Insider before presenting.*
- The roster exodus (Dec 2025, then CORE) showed the cost: when creators leave, the fan link leaves with them.
- Meanwhile 15 years of iconic FaZe moments sit in an archive that fans cannot own, collect or trade.

## 2. Solution
FaZe Collector Cards is a first-party collecting app. It turns FaZe's history and roster into digital trading cards that fans open, collect, trade and show off. FaZe staff run it as a business from the Control Room.

**Fan side [built]**
- Sign up and get 500 starter coins (demo, no cash value).
- Packs of 5 cards with **published odds per pack** (v1: common 70 / rare 20 / epic 8 / legendary 2). Pulls use a server-side CSPRNG and every pull is logged with its odds version.
- Every copy has a unique **serial number**. Supply caps are enforced.
- Collection grouped by set and rarity, with duplicates and serials shown.
- **Trading:** direct fan-to-fan offers plus a **public marketplace**. List a card, others offer cards in exchange (cards for cards, no money changes hands), with an atomic swap and in-app notifications.
- **Leaderboard** of collectors, scored by rarity weight (1/3/10/25).
- **Trending** cards driven by a hype stat [demo/simulated: engagement is simulated by a worker and labelled "simulated" in the UI].
- **Buy coins with Phantom on Solana devnet** [built, test payments only]. The server verifies each transaction on-chain before crediting, and mainnet is refused at boot.
- FaZe-brand UI: intro splash, pack-tear reveal and a glitch effect on epic and legendary pulls.

**FaZe side: Control Room [built]**
1. **KAM Intelligence.** Scans the FaZe archive (333 timeline moments) and ranks the top 12 drop opportunities. Each score is explained as the sum of 5 signals: anniversary, member momentum, collector demand, catalog gap and archive weight. Moments about lawsuits, gambling, health, harm or controversy are meant to be excluded.
2. **Moment Studio.** Drafts a 5-card set (common to legendary) whose lore is grounded only in the archive text. A local LLM rewrite is optional. Studio checks every draft against the existing catalog for duplicates.
3. **Approval with a rights gate.** A campaign can't launch until a staff member confirms that FaZe has the rights to the moment and the member likenesses. Every decision goes to an append-only audit log.
4. **Launch.** Creates the set, cards and pack (with published odds) through the same validated admin endpoints, then publishes.
5. **Metrics.** Pulls, collectors, coins spent, cards minted, trades involving the drop, average hype, rarity mix, opens per minute and attributed devnet purchases. [demo/simulated: a "simulate" button sends up to 40 labelled demo fans through the real pack-open endpoint.]
6. **Moment Scout** (YouTube discovery feeding KAM's reach signal). [Built on a teammate branch, not yet on `main`. Live view counts are never stored in scan evidence, per the YouTube 30-day rule.]

## 3. Why FaZe
- **Owned IP that can't walk out.** Moments, eras and the brand stay with FaZe even when creators leave.
- **15 years of archive** is ready-made content: OG MW2 era, FaZe House, esports wins, creator milestones.
- **The audience fits collecting.** Gen Z gamers already understand packs, rarity and trading from Ultimate Team, Pokémon TCG Pocket and skins.
- **First-party fan data.** FaZe sees who collects what, which members drive demand and which drops work, instead of renting that insight from platforms.

## 4. Target users
- **OG fans** (MW2 / FaZe House era): nostalgia sets.
- **Current fans:** roster and esports drops, and the lore behind the jokes.
- **New Gen Z fans:** a low-friction way in. Free starter coins, a shareable rare pull.
- **Collectors and traders:** serials, rarity, the marketplace and the leaderboard.
- **FaZe staff and partners** (buyer side): content, community and partnerships teams who need a repeatable way to turn moments into revenue and measure it.

## 5. How it works (loop)
Archive moment → KAM ranks it → Studio drafts the cards → staff confirm rights and approve → drop launches with published odds → fans open packs, trade and climb the leaderboard → the Control Room measures the drop → the next KAM scan uses that collector demand.

Server-authoritative design: the server alone decides pulls, odds, balances (append-only ledger), trades (cards locked on offer, swapped in one transaction) and payments (verified on-chain). The client only renders.

## 6. Monetization (model, not live revenue)
| Lever | Status |
|---|---|
| Coin bundles (today 1,000 / 2,500 / 6,000 coins for 0.05 / 0.1 / 0.2 **devnet** SOL) | [built, test payments only] |
| Packs bought with coins (100 coins, 5 cards; campaign drops priced per drop, e.g. 150) | [built] |
| Rights-gated **campaign drops**: limited, time-boxed sets tied to anniversaries or moments, ended from the Control Room (pack retired) | [built] |
| Sponsored drops (a brand presents a set), merch or event unlocks for set completion | [proposed] |
| Real-money checkout (fiat or mainnet) | [proposed; requires legal review and age gating, see section 9] |

Principles: odds are always published before purchase, coins can't be cashed out, and there are no paid random items without disclosed odds. The marketplace is cards for cards only, with no coin or cash resale.

Illustrative sizing (from the Canva deck, an assumption and not a forecast): 30M followers, 1% collect, 3% of those pay $5/month, about $540K/yr before sponsors and merch.

## 7. Engagement loop
- Starter coins, then a first pack with a cinematic reveal, then a rare pull with the glitch moment worth sharing.
- Set completion and serial hunting lead to trades with other fans (public marketplace and notifications).
- The leaderboard rank and Trending hype give reasons to come back.
- Staff ship timely campaign drops (anniversaries, member momentum), so there is always something new in the store.
- [proposed] Daily free pack, live "moment" claims during streams, shareable card images, crafting duplicates up a tier.

## 8. KPIs the Control Room measures [built]
- **Overview:** collectors (total, demo, new in 24h), packs opened (total and 24h), coins spent on packs, coins purchased, devnet SOL received, paid purchases, trades accepted and open, live campaigns, approvals pending, moderation queue, top-pulled members (7 days), pack opens per hour, coin economy per day, system health (API, DB, worker, job queue, payments).
- **Per drop:** pulls, unique collectors (real vs demo), coins spent, cards minted, trades involving the drop, average hype, purchases and SOL attributed to the drop (last-touch: devnet purchase in the 24h before a collector's first pull of the drop), rarity mix pulled, pulls per minute.
- **Trust:** an append-only audit log of every scan, draft, edit, approval (with the rights confirmation), launch, simulation and end.

## 9. Risks and compliance
- **No gambling framing.** Coins are demo credits with no cash value and can't be redeemed or cashed out. There are no payouts and no coin or cash resale. Odds are published per pack and versioned, and every pull is logged with the odds version used. Any move to real money needs legal review for loot-box rules (e.g. Belgium and the Netherlands, odds-disclosure rules elsewhere), age gating and spend limits.
- **Payments.** Solana **devnet only**: mainnet is refused at boot, payments are test funds, and the server verifies every payment on-chain. No NFTs or tokens are issued; the database is the source of truth.
- **Rights and likeness.** No drop launches without a staff rights confirmation. Demo art is generated placeholder SVGs, not FaZe photography. A real launch needs a licensing agreement with FaZe and each member.
- **Content safety.** Display names, trade messages and fan-art submissions go through moderation (auto-flags plus staff review) before other fans see them. KAM is designed to skip controversy, legal, health and gambling moments. *Known gap: a "viewbotting accusations" moment ranked #2 in today's scan, so the filter needs tightening.*
- **Simulated data.** Hype, demo collectors and engagement spikes are simulated and labelled "demo" or "simulated" in data and UI. Don't present them as real traction.
- **Platform terms.** Moment Scout uses YouTube data only as a ranking signal and never stores live view counts in scan evidence or card lore.

## 10. Roadmap
- **Now (hackathon):** full demo flow on devnet, the Control Room loop, public marketplace.
- **Next:** merge Moment Scout and tighten KAM's sensitive-topic filter. Add real card art from FaZe's library, share images for pulls, and a daily free pack.
- **Pilot:** a licensed, time-boxed anniversary drop with FaZe and a small cohort of real fans. Measure retention, trades per collector and drop sell-through in the Control Room.
- **Later:** sponsored sets, live stream "moment" drops, crafting, merch and event unlocks. Real-money checkout only after legal review.
