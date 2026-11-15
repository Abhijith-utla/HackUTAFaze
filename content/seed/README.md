# Demo content

Run `node content/seed/generate.mjs` from the repository root to regenerate the deterministic three-set, 40-card catalog and original SVG geometric artwork. No images are scraped and no portraits or logos are copied. All characters and moments are demo collectibles; imagery is abstract placeholder art.

Agent A's seed command imports `catalog.json` and preserves IDs. Art is served by the API at `/demo-art/<UUID>.svg`; clients resolve these paths against the API origin. Seeds are live/active for the demo flow and every set/card is labelled demo. New sets created through admin start as drafts. Card stats are initialized by the importer.
