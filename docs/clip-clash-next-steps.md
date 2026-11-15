# Clip Clash: artwork game readiness

Clip Clash now uses the existing Chain Reaction card artwork and server-side tags. No video uploads, clip timestamps, clip approval or rights-reference fields are required to play. Legacy optional video endpoints remain available but are not part of gameplay.

## Required setup

1. Confirm the private DATABASE_URL targets the intended development database before applying migrations. The user has confirmed the configured Tiger target is development/demo. Migrations 007 and 008 are present there, and repair 012 has been applied. API startup automatically migrates; confirm the target before restarting.
2. For a fresh environment, apply the forward migrations (including repair 012) from the repository root:

   ```powershell
   npm.cmd run migrate -w @faze/api
   ```

3. On the existing 40-card database, migration 008 enables the cards, assigns curated suitability tags and configures the CPU deck. On a fresh database, use the normal catalog seed and artwork import to create the cards and database images first; the catalog seed also configures gameplay tags and CPU membership.
4. Humans still select five different owned, available moments. Cards are reserved, never consumed or transferred. The CPU does not need owned copies.

## Fixed CPU deck

- Antwerp Major Win: clutch, precision, teamwork.
- Pro League S15: comeback, resilience, teamwork.
- Subathon Finale: reaction, celebration, creators.
- Funniest Moments #1: comedy, reaction, surprise.
- FaZe x Man City: collab, creators, teamwork.

The CPU greedily picks its highest-scoring unused card for the current prompt. Rarity and base power do not decide results. Artwork and tags are frozen in each confirmed lineup.

## Remaining work

- Play real two-account browser matches and CPU matches on desktop/mobile after database activation. Check artwork loading from Tiger, reconnect, reveal animations, score bars, ties and lock release.
- Review the curated demo tags for game balance. Catalog gameplay tags are explicitly authored annotations, not inferred facts about real footage. Tune prompts through forward migrations or reviewed admin changes.
- Staff can use PATCH /admin/game/cards/:id/gameplay with enabled, tags and cpuPool. A dedicated staff tag-editing/CPU-deck UI is still optional future work.
- Test simultaneous matches and polling at expected traffic levels. Consider media caching and request limits before public release.
- Match expiry cleanup currently depends on the API running. An independent scheduled cleanup job would improve unattended operation.

The UI animates artwork into place and raises suitability meters to the actual server-resolved score. Matching tags and points explain the result. Reduced-motion preferences skip the animation. The animation does not choose or change the winner.

## Current validation

All 11 focused game tests pass, including artwork-only CPU matches without video fields. API/shared/client typechecks and an isolated production build pass. Desktop and 375px browser fixtures verified both score bars reach the server values with no horizontal page overflow. The broader regression run passed 98 of 99 tests; its moderation-queue assertion in insights.test.ts failed, outside the focused game tests. Real two-account/media-database checks remain part of activation.

## CPU startup repair

CPU match creation previously returned HTTP 500 because the running API inserts a frozen prompt_pool but the already-migrated Tiger match table did not have that column. Migration 012_clip_clash_prompt_pool.sql adds the column without rewriting applied migrations. It rebuilds missing pools using already-played prompt snapshots first, then unused active prompts; it does not modify scores, ownership or current rounds. The user approved applying this repair to the development/demo Tiger database, and it has been applied.
