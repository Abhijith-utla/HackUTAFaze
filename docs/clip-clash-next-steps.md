# Clip Clash: what remains

The implementation is merged. The shared Tiger database has NOT received migration 007, and no real video clips have been uploaded or approved. The existing 40 artworks remain collectible; artwork alone does not make a card playable.

## Required to enable the game

1. Confirm the intended Tiger database is a development environment and take a backup. Check the private `DATABASE_URL` without sharing its credentials. The API currently applies migrations at startup, so confirm the target before restarting the updated API.
2. With `DATABASE_URL` pointing to the confirmed development target, run from the repository root:

   ```powershell
   npm.cmd run migrate -w @faze/api
   ```

   This applies `007_clip_clash.sql`. Do not edit applied migrations. No database reset or reseeding is required for existing cards.
3. Supply actual licensed/reviewed MP4 or WebM clips. Use an authenticated admin session to call `POST /admin/game/assets` with `{mime, base64}` (20 MiB maximum decoded asset). Save the returned `assetId`. The bytes live in PostgreSQL/Tiger, not a local media folder.
4. Attach each uploaded clip with `PUT /admin/game/cards/:id`. Required fields are `clipAssetId`, `startMs`, `endMs`, `tags`, `rightsReference`, `description`, and `approval`. Optional fields include `thumbnailAssetId`, `game`, `event`, `featuredMembers`, and `cpuPool`. Use actual source/usage records, validate playback and timestamps, and set `approval` to `approved` only after review. Optional thumbnails are uploaded through the same asset endpoint using PNG/JPEG.
5. Assign at least five different approved playable cards to the fixed CPU pool using `cpuPool: true`. Without this, Play CPU remains unavailable.
6. Each human needs five different approved moments in their collection, with available owned instances. Duplicates of one moment do not count as five distinct cards. Uploading clips does not grant cards, consume cards or change ownership.
7. Start the API and client, sign in, and open Game. Test CPU play, then use two separate accounts/browser sessions for an invite match.

For example, after a real upload, the metadata request body has this shape (replace the placeholders; do not use invented asset UUIDs):

```json
{
  "clipAssetId": "UUID returned by the asset upload",
  "startMs": 0,
  "endMs": 12000,
  "tags": ["clutch", "teamwork"],
  "rightsReference": "Your reviewed source/usage record",
  "description": "A short description of the actual moment",
  "approval": "approved",
  "cpuPool": true
}
```

## Content work

- Review and annotate the moments with consistent tags. The five prompts currently weight clutch/precision/teamwork, comeback/resilience/clutch, reaction/surprise/celebration, comedy/surprise/reaction, and collab/teamwork/creators. Exact weights are in migration 007 and `docs/api.md`.
- Check that clip durations and timestamps match the uploaded media. Current upload validation checks file signatures and size; it does not decode/transcode video or prove that endMs is within the media duration.
- Supply captions or transcripts where appropriate. Current playback has native accessible controls and loading/error fallback, but no caption upload workflow.
- Clip preparation currently uses authenticated admin API calls. A dedicated staff upload, preview, tagging and approval screen remains to be built.

## Remaining verification before release

- Complete real browser testing on desktop/mobile with actual videos: loading, seeking, errors, cross-origin session cookies and clip boundaries. MP4/WebM codec compatibility depends on the actual encoding.
- Play a full two-account match over the network, refresh both browsers after submitting, and verify that the opponent's choice stays hidden until resolution. Test disconnect/rejoin, cancellation and expiry as well.
- Verify that game-locked copies are unavailable in real collection/trade/listing screens and become available again after closing the match.
- Exercise multiple concurrent matches with representative media sizes. Consider request limits and media delivery/storage scaling before public traffic.
- Expiry cleanup currently runs in the API every minute, on startup, and on game traffic. When the API is stopped, locks remain until it resumes cleanup. An independent scheduled cleanup job would improve unattended operation.

## Implemented and validated

The Game tab, invite/CPU matches, five-card lineups, exclusive inventory reservations, deterministic tag scoring, hidden submissions, saved snapshots, first-to-three/five-round draw rules, cancellation/expiry cleanup, and authenticated database media serving with byte ranges are implemented.

Validation completed on isolated local PostgreSQL: the 90-test API regression suite passed, followed by all 10 expanded Clip Clash tests (including privacy, frozen prompts and media ranges). Workspace typechecks and the client production build passed. These checks did not migrate or modify Tiger Data, and they do not replace the real-media/browser checks above.

See `docs/api.md`, `docs/data-model.md`, and `content/seed/README.md` for the endpoint and schema details.
