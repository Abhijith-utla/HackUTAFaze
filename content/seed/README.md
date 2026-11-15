# Demo content

The current catalog uses the 40 cards from the user-supplied `faze_chain_reaction_40_cards.zip`. These are AI-generated demo concept illustrations, not archival photographs. Their PNG bytes are stored in Tiger Data's `card_art` table; `catalog.json` references database-backed `/art/<UUID>.png` URLs. No replacement PNG files are needed in the repository or on the API filesystem.

The import preserves the existing 40 card IDs, sets, pack configurations and owned instances. Source bronze/silver/elite/legendary map to common/rare/epic/legendary. The source cards are distributed across the three existing sets with every rarity in each set. Source metadata is retained on each catalog entry under `sourceCard`.

To import into another database, configure its private `DATABASE_URL`, run migrations and the normal seed to create the catalog rows, then run from the repository root (requires Python's standard ZIP reader):

```powershell
node --import tsx services/api/src/import-card-pack.ts 'C:/path/to/faze_chain_reaction_40_cards.zip'
node --import tsx services/api/src/import-card-pack.ts 'C:/path/to/faze_chain_reaction_40_cards.zip' --apply
```

The first command validates without writing. `--apply` imports directly from ZIP memory, replaces the definitions in one transaction, verifies stored image hashes and unchanged ownership, and updates catalog URLs for that database. A pre-import metadata backup is kept in ignored `.data/card-replacement/`. Preserve the original ZIP as a backup; database URLs alone cannot recreate missing image bytes in a fresh database.

The legacy `generate.mjs` regenerates the original geometric SVG placeholders and overwrites this catalog. Do not run it for the Chain Reaction collection. The old SVGs can remain as legacy fixtures; current cards no longer reference them. Every replacement card remains labelled demo.
## Clip Clash artwork gameplay

The catalog gameplay field defines enabled state, curated tags and fixed CPU membership. Migration 008 applies the same setup to the existing 40 cards; fresh databases receive it through the seed. No videos or clip approval are required. See docs/clip-clash-next-steps.md for activation instructions and the fixed CPU deck. Do not run migrations against an unconfirmed shared/production Tiger target.
