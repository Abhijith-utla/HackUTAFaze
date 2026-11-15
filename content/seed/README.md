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
## Preparing Clip Clash clips

Artwork is not a video clip. The existing Chain Reaction illustrations remain pending and are not silently approved or assigned fabricated video URLs. Staff upload a licensed, reviewed MP4/WebM through `POST /admin/game/assets`, then attach its returned UUID with `PUT /admin/game/cards/:id` (see docs/api.md). Provide tags, a real rights reference, interval and approval. Use `cpuPool:true` for at least five approved cards to enable CPU play. Tags are content annotations, not instructions from source files. Upload thumbnails through the same asset endpoint with an image MIME type if needed. Human players still need five different owned approved moments.

Migration 007 was developed for PostgreSQL/Tiger Cloud. Before applying it, verify that your private DATABASE_URL points to the intended development database. The current configured Tiger environment is shared and has not been confirmed as nonproduction, so Clip Clash's migration must not be applied there implicitly. The API's existing startup runs migrations: confirm the target before restarting the new version. After configuring an explicitly approved development target, run from the repository root:

```powershell
npm.cmd run migrate -w @faze/api
```

No existing migrations are rewritten. A backup and normal deployment coordination are needed before adopting the schema on a shared environment.
