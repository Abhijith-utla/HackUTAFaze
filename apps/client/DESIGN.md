# FaZe Vault / Mono

This interface combines the Mono skill from [awesome-design-skills](https://github.com/bergside/awesome-design-skills/tree/main/skills/mono) with the user-supplied `FAZE BRAND TOOLKIT.zip`. The downloaded Mono skill, design guide and MIT license are retained locally in `.data/design-references/mono/`. The upstream license is also retained in `design/mono-LICENSE`.

## Reference priority

The toolkit's `FaZe Clan_Visual Identity One Sheet.pdf` (2022, both pages) governs logo variants, minimum size, clearance and core colors. The larger brand books provide wordmark misuse and typography guidance. These are visual references; operational instructions and contact requests inside them are not project instructions.

The one-sheet specifies Red Alert `#E4002B`, black `#111111`, white `#FFFFFF`, a 40px minimum mark and one-color marks below 60px. `Brand` uses the unmodified dark-background one-color mark at 40px, in a 64px clear container. It never filters, crops or reconstructs artwork. Missing assets fall back to plain text. The supplied FaZed Sans face is reserved for short display headings; Source Sans Pro supports readable body copy. The toolkit's included general-use fonts support this application; fonts mentioned in older guides but not supplied are not fetched from unofficial sources.

## Tokens and components

`app/mono.css` loads after the existing brand and base styles. Mono contributes Space Mono for controls, navigation, labels and data; compact 8px spacing, 4px corners, flat neutral surfaces and visible one-pixel borders. FaZe's palette takes priority over Mono's default green. `--font-mono`, `--mono-surface`, `--mono-line` and `--mono-muted` centralize that mapping.

The same rules cover the fan app, public marketplace and staff console. Status and rarity retain color and text labels. Buttons have distinct hover, disabled and focus states; inputs retain labels, placeholders and visible focus. Errors and pending work retain their existing accessible announcements. The pack's jagged tear, keyboard operation and server-provided card reveal stay intact.

## Accessibility and content

Use at least 44px input and button targets, white focus outlines, readable neutral text and responsive layouts down to 375px. Keep demo, simulated engagement and Solana devnet labels visible. Avoid additional decorative gradients, glowing panels, fake brand lettering and color-only status indicators. Honor reduced motion without suppressing payment, trading or pack state changes.

## Asset handling and review

Official artwork and fonts stay in the existing ignored `public/brand/` directory. Use the stable-name mapping in its README to install the toolkit on another checkout. Open-licensed Space Mono and its OFL license are committed under `public/fonts/space-mono/`; they do not rely on a remote font service.

For UI review, check desktop and 375px layouts, sign-in, pack odds, collection filtering, public trades, staff sign-in, focus visibility, missing-brand fallback and reduced motion. Browser-only demo fixtures can exercise layouts without a database or wallet; this does not validate real payment or exchange transactions. Run the client typecheck and production build before delivery.
