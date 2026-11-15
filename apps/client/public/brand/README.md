# FaZe brand assets (local only)

**Source:** FaZe Brand Toolkit, a Google Drive folder shared for the HackUTA FaZe track.

**Why these files are not committed:** the toolkit does not say whether the files may be redistributed in a public repository. The lead decided to keep them local. `.gitignore` in this folder ignores everything except this README and the `.gitignore` itself. Do not commit any of the asset files.

## Files

### Stable names (used by the client)

| File | What it shows |
|---|---|
| `faze-wordmark-white.png` | Unaltered copy of `wordmark/asset-5.png`. The white horizontal "FAZECLAN" lockup with the FaZe icon, which has a white fill and black/red outline. Transparent background, 1214x120. **For dark backgrounds only.** |
| `faze-mark-white.png` | **Not present.** The toolkit has no standalone white icon or short "FaZe" mark. The icon appears only inside the lockups, and cropping it out would alter the logo, which the brand rules forbid. |

### `wordmark/` (originals as named in the toolkit: "Asset N.png")

All files are transparent PNGs.

| File | Size | What it shows |
|---|---|---|
| `asset-1.png` | 584x108 | Black "FAZE®" wordmark, classic geometric typeface |
| `asset-2.png` | 499x198 | Black stacked "FAZE / CLAN" (bold FAZE over thin CLAN), classic typeface |
| `asset-3.png` | 965x93 | Black horizontal "FAZECLAN®" (bold FAZE, thin CLAN), classic typeface |
| `asset-4.png` | 1222x120 | Red icon + black "FAZECLAN" horizontal lockup, classic typeface (for light backgrounds) |
| `asset-5.png` | 1214x120 | White version of asset-4: white-fill icon with black/red outline + white "FAZECLAN" (for dark backgrounds) |
| `asset-6.png` | 503x103 | Black "FAZE®" wordmark, newer custom typeface (FaZed Sans style) |
| `asset-7.png` | 404x172 | Black stacked "FAZE / CLAN", newer custom typeface |
| `asset-8.png` | 1473x128 | White "FAZE [icon] CLAN" lockup, newer typeface; icon has white fill and black/red outline (for dark backgrounds) |
| `asset-9.png` | 838x85 | Black horizontal "FAZECLAN®", newer custom typeface |
| `asset-10.png` | 1473x128 | Black "FAZE [red icon] CLAN" lockup, newer typeface (for light backgrounds) |

### `fonts/`

| File | Notes |
|---|---|
| `FaZedSans.otf` | FaZe custom display face. Drive file name is `Sample_FaZed_Sans.otf`, and at about 9 KB it is probably a sample with a limited character set |
| `BebasNeue-Regular.ttf` | Condensed display face |
| `Anton-Regular.ttf` | Condensed display face |
| `SourceSansPro-Regular.ttf` | Body text |
| `SourceSansPro-SemiBold.ttf` | Body text |
| `SourceSansPro-Bold.ttf` | Body text |
| `SourceSansPro-Black.ttf` | Body text |

## Brand rules

- Colors: **Red Alert `#E4002B`**, **Black `#111111`**, **White `#FFFFFF`**.
- Do not recolor, distort, stretch, rotate, or add effects (shadows, glows, outlines, gradients) to the logo or wordmark.
- Use white marks only on dark backgrounds, and black marks only on light ones.
- Minimum size: 40px.
- Clear space: keep 150% clearance around the logo/wordmark.

## How to re-fetch

1. Open the Google Drive folder **"FAZE BRAND TOOLKIT"** (shared for the HackUTA FaZe track).
2. Download `Asset 1.png` ... `Asset 10.png` into `wordmark/` as `asset-1.png` ... `asset-10.png`.
3. Download the fonts into `fonts/` using the names above (rename `Sample_FaZed_Sans.otf` to `FaZedSans.otf` and `Bebasneue_Regular.ttf` to `BebasNeue-Regular.ttf`).
4. Copy `wordmark/asset-5.png` to `faze-wordmark-white.png` without changing it.
