# HamsterRun design system

## Overview

HamsterRun is an independent Sepolia game for visitors minting a HAM, planning training, racing another owner, and inviting friends. The visual idea is a small mint-green meadow populated by chunky pixel hamsters, surrounded by a calm, practical game interface. The art is playful; transaction, certification and error copy stays literal.

`web/src/style.css` is the styling source of truth. `App.tsx` owns the shared frame, mint, training and boards; `Racing.tsx` owns rival discovery, pending challenges and the race inspector; `Wallet.tsx` owns the native wallet dialog; `Invites.tsx` owns off-chain invite forms and the board. The production export is root `dist/`. All artwork and fonts are local.

## Colors

Use the semantic properties in the `:root` block rather than borrowing a border color for text. Hex is the implemented color format. There is one light theme; a dark theme is not implemented.

| Token | Value | Role |
| --- | --- | --- |
| `--page` / `--cream-50` | `#faf9f2` | Warm page background |
| `--surface` | `#fffef9` | Game panels and wallet dialog |
| `--surface-muted` / `--cream-100` | `#f1efe3` | Mint panel and neutral interaction background |
| `--ink` / `--brown-900` | `#373c31` | Main text, headings and control boundaries |
| `--muted` / `--brown-600` | `#625449` | Secondary text and helper copy |
| `--line` | `#dddcd0` | Panel structure and dividers |
| `--accent` / `--orange-200` | `#f9d4b0` | Primary action fill |
| `--accent-hover` / `--orange-400` | `#f0b77f` | Primary action hover |
| `--green-100` | `#e6f0dd` | Selected HAMs and certified round surfaces |
| `--green-200` | `#c9e9ce` | Meadow surround, selection and active wallet row |
| `--green-600` | `#46704d` | Active navigation indicator and positive status dot |
| `--focus` | `#3c6245` | Keyboard focus perimeter |
| `--status-bg`, `--status-text` | `#edf1de`, `#43513c` | Core status banner |
| `--error` / `--red-700` | `#963c32` | Inline errors |
| `--purple-100` | `#ece4f3` | Race-network tag |

The Core warning variant uses `#f3e6cd` with `#584a30`. Disabled buttons use `#e9e8de` and the normal muted foreground. Status always has accompanying text or an icon. A green dot alone never explains certification or connection. The header only uses its positive dot when mint, Core, genesis-pin and wiring reads are verified; its adjacent label is “reads online”. A lagging but readable Core keeps its separate frontier/lag explanation.

The rendered design probe measured 10.74:1 for ink on the page, 6.90:1 for muted text on the page, and 7.35:1 for the normal Core banner text/background. All text pairs that the probe resolved met 4.5:1, or 3:1 for large text. It excluded two text boxes associated with the image surface; those are not claimed as measured. See the validation record for coverage.

## Typography

- **Nunito** is the interface/body face, with `ui-rounded, system-ui, sans-serif` fallbacks. The local Latin variable WOFF2 is declared for weights 400–700; the site uses 400 and 700.
- **Pixelify Sans**, registered as `Pixelify`, is the wordmark and primary headline face at weight 700. Its fallback is the rounded/system stack.
- Files are `web/public/fonts/nunito-latin.woff2` and `pixelify-latin.woff2`. Their licenses are in the same folder. Both faces were confirmed loaded in Chromium.

The six semantic size roles are `--text-sm` 13px, `--text-base` 16px, `--text-lg` 20px, `--text-title` 24px, `--text-brand` 28px and `--text-display` 48px at the default 16px root. The mobile display role becomes 32px; the brand becomes 24px, then 20px below 360px. Each measured width used no more than six actual sizes. Editable fields and the match-link field remain 16px on phones. The existing read-only invite-link field uses the 13px small-text role and exposes full selection/copy.

Body line-height is 1.5; h1 is 1.1, h2 1.25 and h3 1.3; race-status headings use 1.4 for long match IDs. Display tracking is −0.035em; h2 is −0.02em. Headings balance their lines and paragraphs use pretty wrapping. Numbers use tabular figures. Full uint256 match IDs wrap with `overflow-wrap: anywhere` in the race panel. Addresses wrap in the wallet details/footer; the short wallet control opens the complete checksummed value. The share-link input scrolls/selects the complete value and has a separate copy action.

## Layout

The main content and header share a centered 1200px outer width, increasing to 1264px above 1400px, with 32px inline padding. Main vertical groups are separated by 24–56px. The declared spacing steps are 4, 8, 12, 16, 24, 32, 48 and 64px; component padding also uses 20, 22 and 28px where the existing density needs it.

- Desktop welcome is a `1.35fr / 1fr` grid: meadow, then mint controls. It has one tonal outer surface rather than nested cards.
- Training and racing use equal grid columns with a 24px gap and align to the start, so the shorter training panel does not stretch to match the longer race panel. HAM choices use an auto-fit grid with a 290px preferred minimum.
- At 1080px, header spacing and panel padding tighten; forms wrap if needed.
- At 760px, navigation moves to a second header row, the welcome and game grids stack, page padding becomes 20px, the meadow uses the final 3:1 aspect-ratio override, and the footer and invite layout become one column. The secondary invite illustration is omitted so the handle form and create action fit the first phone screen. The main play meadow remains visible.
- At 360px, page padding becomes 16px, controls can stack, and six round tiles form two columns instead of three.
- The weekly five-column table can scroll within its own container. The page itself does not scroll horizontally at the five tested widths.

The Core banner is always rendered above the current view, is not dismissible, and uses normal document flow. Its unpinned variant adds a short explanation and Pin genesis/Connect action in that same flow. A “Find a rival” anchor below the page description keeps racing reachable on the first screen. Shared match links scroll to the match inspector after its first read; later polling does not repeatedly scroll the page. Wallet lineups retain their last completed result during background polling; explicit Sepolia refresh also updates ownership and Stamina. A stable wallet query lets a large collection scan finish instead of restarting it for every block. A booking repeats its own pending/paused/certified status beside settlement. Nothing is fixed over a transaction control. Actual layout checks covered 320, 390, 760, 1080 and 1440px. Native browser zoom and RTL mirroring were not checked.

## Elevation & Depth

The interface is mostly flat. Panels use a single 1px structural border; controls use a 1.5px boundary. Tonal fills distinguish the meadow, mint area, selection and certification. Panels do not combine borders and shadows. The wallet dialog is the only raised surface: `0 20px 80px #373c3133`, with a `#27352370` backdrop and no dialog border.

## Shapes

Welcome corners are 16px, panels 12px, buttons 9px, inputs 7px and tags 5px. The native wallet dialog has 16px corners; wallet rows have 8px corners. Pixel art uses stepped paths and `image-rendering: pixelated`. Artwork is decorative unless its alt text communicates the meadow scene. Do not apply pixel fonts to dense instructions or data tables.

## Components

| Pattern | Source | Behavior and reuse |
| --- | --- | --- |
| `.button`, `.primary`, `.button-small`, `.text-button`, `.icon-button` | `style.css` | Native buttons/links; primary fill for the local main action; 48px normal and 44px compact controls; disabled, hover and pressed styles |
| `Wallet` | `Wallet.tsx` | One header control; EIP-6963 names and icons, including phone providers without legacy `window.ethereum`; phone deep links; Coinbase; wrong-chain switch; connected account details and disconnect |
| Native `.wallet-dialog` | `Wallet.tsx`, `style.css` | `showModal()` supplies modal focus containment; Escape, backdrop and close control dismiss it; focus returns to the opener. Bottom sheet on mobile, centered at larger widths |
| `CoreBanner` | `App.tsx` | Loading, unknown, unpinned, identity-check failure, paused, lagging and caught-up states; conditional permissionless pin CTA, transaction status, details and a named refresh control |
| `.pet-choice` | `App.tsx` | Native toggle-style button with `aria-pressed`; full HAM ID, Stamina and band/lock state; visible selection check |
| `Training`, `BookingView` | `App.tsx` | Labeled future-round/day fields; one booking per day; six round tiles; unknown work remains null and is labeled Unknown; certified settlement only |
| `Racing` | `Racing.tsx` | Same-band rival rows, bounded scan progress/retry, incoming/outgoing offer inbox, manual ID disclosure, match link/lookup and race state. Props carry the selected pet, latest snapshot, wallet eligibility, send callback, notice and Connect action. |
| `.rival-list`, `.offer-list` | `Racing.tsx`, `style.css` | Semantic lists with plain structural dividers. Rival rows use art, HAM ID/Stamina/lock text, and a compact Challenge button; offer rows wrap with Accept or Cancel plus View match. Empty, error, partial-scan and refresh states are explicit. |
| `RaceStepper`, `.race-stepper` | `Racing.tsx`, `style.css` | Four equal columns: Offered, Accepted, Save seed, Settle. Static 30px numbered circles use muted, green-complete and peach-current fills, plus text weight and `aria-current="step"`. Cancelled/expired races have no active step. Real block/time requirements sit beneath the stepper, not in an animation. |
| `.share-match`, `.match-lookup` | `Racing.tsx`, `style.css` | Read-only 16px full-link selection, named copy action with persistent success/fallback status, validated ID/full-link loading, and focus to the invalid field. Links preserve the hosting subpath. |
| `TransactionNotice` | `App.tsx` | Persistent in-flow status at the action that created it; checking, wallet confirmation, submitted, confirmed, failure and explorer link |
| `InvitePanel`, `InviteLeaderboard` | `Invites.tsx` | Handle validation, signed registration, copy/X intent, backend readiness, retryable credit; bounded loading and honest empty/offline/invalid-response board states. An unconfigured URL immediately fails as offline instead of assuming a relative API |
| `Leaderboards` | `App.tsx` | Two native selector buttons with `aria-pressed`; separate weekly game scores and invite mints; semantic tables and recoverable loading errors |

Focus uses a 3px solid `--focus` outline, offset 4px. A focused wallet row was visually checked; keyboard-only Tab/Escape checks confirmed the visible focus and dismissal path. The sheet opens only after an explicit Connect or wallet-management action. Forced-colors mode preserves system Highlight/GrayText. Transitions are limited to background and transform, 120ms with `cubic-bezier(.2,0,0,1)`, and only run under `prefers-reduced-motion: no-preference`. Press scale is 0.96. There is no endless animation.

## Do’s and Don’ts

- Reuse `.page`, `.page-heading`, `.panel` and the native form/control patterns for another view. Add a hash view through the existing navigation rather than assuming server route rewrites. Home links use the native empty fragment to return to the top.
- Keep the product and primary action near the top at 390px. Secondary illustration yields to the form.
- Use Stamina for the NFT attribute, address points for the wallet counter, and invite mints for the off-chain board. Keep those quantities separate.
- Reuse the race list/stepper patterns for match work; keep DOM order aligned with reading order, use normal-flow rows, and explain partial scans. Match consent remains challenge → accept.
- Treat a missing or stale read as unknown. Do not derive zero work from a pending booking or round.
- Let mint availability follow the verified mint flag and allowance. Gate game actions on verified game wiring, and explain an unchecked/incomplete state beside their controls. Mint availability is independent of Core and game-wiring failures.
- Keep recovery copy beside the failure and full addresses reachable. Never add fake players, scores, certification, token value or financial promises.
- Keep new runtime assets local and preserve the relative export URLs. Use the optional `generate-share.mjs` to regenerate the existing 1200×630 share card if the art changes.

This is a record of the final implementation, not an independent accessibility or contract certification. Design-source attribution and licenses are retained in `web/licenses/`.
