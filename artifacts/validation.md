# HamsterRun match UX validation

## Scope and completion

**Complete for the stated scope**, using the explicitly permitted offline invite mode. This revision updates the existing pixel pastel React/TypeScript site and root static export. Sepolia contracts, contract tests, ABIs, dependency manifests/lockfiles, build configuration and ignore files are unchanged. No transaction was sent and nothing was published by the worker.

Implemented: same-band rival discovery; wallet-specific Offered inbox with Accept/Cancel; `?match=<id>` links and automatic clipboard attempt/manual fallback; race stepper and exact TTL/hash/time gates; conditional permissionless genesis pin; independent, honest Core/mint/wiring reads; explicit invite-service offline behavior. The existing challenge → accept mechanism remains authoritative.

No real public invite API URL appears in the supplied or currently hosted configuration. The export leaves that setting empty, labels invites/board offline, and does not invent a service. A configured local service was separately exercised. A deployment/publishing task is not part of this work.

## Actual commands and results

Because protected dependencies and `node_modules/` could not be changed in the repository, the unchanged frontend manifest/lockfile were copied to `/tmp/hamsterrun-revision/web/`, installed there with `npm ci`, and the exact `web/` sources/config/assets were mirrored into that task-created build directory. Its complete `dist/` was copied back to the repository after the last production source edit. No dependency/cache archive or dependency directory is delivered.

These normal project scripts ran in that build copy and exited **0**:

```sh
npm run typecheck --prefix /tmp/hamsterrun-revision/web
npm run check:abis --prefix /tmp/hamsterrun-revision/web
npm run test:service --prefix /tmp/hamsterrun-revision/web
npm run build --prefix /tmp/hamsterrun-revision/web
```

- TypeScript: passed.
- Production Vite build: passed; complete root export supplied with relative asset URLs.
- Canonical ABI checks: all six match the deployment receipt; deployment addresses and exact network metadata were mechanically compared with the pinned handoff.
- Existing invite-service tests: **6/6 passed**, including signatures, replay, once-per-wallet attribution, self-referrals, persistence and canonical mint-receipt verification.
- Existing nonfatal build warning: transitive `ox/tempo` imports `node:worker_threads`, which Vite externalizes for browser compatibility. No real Coinbase passkey session is claimed.

Production-export interaction validation ran at `/preview/`, with explicit controlled EIP-1193/EIP-6963 and RPC fixtures, not live writes:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node /tmp/hamsterrun-revision/web/scripts/validate-browser.mjs --playwright /opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs --axe /tmp/hamsterrun-a11y/node_modules/@axe-core/playwright/dist/index.mjs
```

**26 scenario groups passed; zero uncaught page errors or missing local resources.** Two axe scans, `accepted-race` and `invite-offline`, returned **zero violations**. The test creates ephemeral accounts in memory; none is configured in the application or export. The stable `validate-browser.mjs` entry point now runs `validate-matches.mjs`.

Coverage includes first-screen mint/rival navigation and closed initial wallet sheet; named wallet discovery, focus/Escape and chain switching; wallet rejection; pin genesis before game wiring; open mint independent of wiring; training validation and unknown/paused/certified work; rival ownership/band/lock filtering and the 80-ID page boundary; Stamina 9,999/10,000 cap behavior; direct challenge, automatic clipboard success and denial recovery; newest-first inbox and earlier-page traversal; acceptance from inbox and a reloaded link; exact target-block and `target+256` boundaries; saved-seed settlement after the hash window and during Core read failure; 1h TTL and outgoing cancellation; separate mint/wiring/Core errors; ID/full-link validation and maximum uint256 ID reflow at 320px; offline invite creation/board and an explicitly configured genuine empty local board; phone wallet rows; reflow at 320/390/760/1080/1440.

A separate read-only public-chain/rendered check exited **0**:

```sh
NODE_USE_ENV_PROXY=1 PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node /tmp/hamsterrun-revision/web/scripts/inspect-live.mjs --playwright /opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs
```

At Sepolia block **12,046,119**, it observed supply **1**, public mint **open**, genesis pinned to **1791847800**, current round **2917**, frontier **1973**, **943** closed rounds unknown, and code at all six deployed addresses. Both local fonts loaded. The actual production page rendered without missing local assets or uncaught script errors, including its offline invite states. These values are an observation, not a prediction of later chain state. [Read-only result](chain-preflight.json).

The pinned taste probe ran from repository root on the final export, both online and with external requests blocked:

```sh
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

**16/16 checks passed online and offline**, covering 320/390/1440 and reduced motion. The 390 screenshot was inspected: product, mint button and Find a rival link are on the first screen. The online probe measured the mint button at y=762.03px with 48px height, fully inside its 844px viewport. The probe reports seven controls below the comfortable 44px target, but none violates its 24px-or-spacing rule. Two image-associated text boxes are excluded from its contrast measurement; no ratio is claimed for those.

## Six-domain Better Interface review

The pinned workflow and all six core domains were read and applied. Existing branding, font assets, spacing, colors and wallet structure were retained. Licenses/notices remain in `web/licenses/`.

| Domain | Coverage | Actual evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native forms/buttons/lists/dialog; names and labels, inline match errors, status regions, step `aria-current`, visible 3px keyboard focus and Escape dismissal; two zero-violation axe scans. No screen-reader session, physical-device session or real-wallet keyboard signing. |
| Layout | Checked | Production at 320/390/760/1080/1440; no page overflow, including maximum uint256 match ID; current phone/desktop screenshots inspected. The primary action is above the fold. No native 200% zoom, RTL mirror or translation-expansion test. |
| Writing | Checked | Clear challenge/accept consent, role-specific Accept/Cancel, 1h TTL, +2-block and ≥15s gates, explicit partial scans, offline invites, Open/Closed/Unavailable mint copy and literal frontier/lag. No fabricated players, work, service URL or SQK claims. |
| Typography | Checked | Two local fonts confirmed loaded, weights 400/700, at most six sizes per tested width, tabular numbers, wrapped long IDs, editable/match-link fields at 16px. Existing read-only invitation URL field is 13px with select/copy. No operating-system font matrix. |
| Colors | Checked | Source tokens and resolved text/background pairs inspected; taste contrast passed. Measured page ink 10.74:1, page muted text 6.90:1, normal Core banner 7.35:1 and mint action 8.13:1. New race/list states inspected; axe scan passed. Image-associated pairs are unmeasured; no dark theme exists. |
| UI | Checked | Rival lists, offer inbox, all race states, manual disclosure, clipboard success/fallback, transaction failure/retry, unpinned/pinned Core, independent read failures and invite online-local/offline states exercised. Phone sheet reviewed; no endless motion; reduced-motion check passed. Real extensions/apps, Coinbase passkeys and animation-panel slow playback not performed. |

## Findings and repairs

All locations refer to the final source; these are worker findings, not independent certification.

| Severity / domain | Location | Observed issue, change and recheck |
| --- | --- | --- |
| High, primary flow | `web/src/Racing.tsx:78`, `web/src/chain.ts:297` | Typed-ID-only challenges provided no way to discover a valid rival. Added bounded authoritative owner/Stamina/lock scans, range coverage and one-action rival rows. Filtering, cap boundaries and a rival beyond ID 80 passed. |
| High, primary flow | `web/src/Racing.tsx:93`, `web/src/chain.ts:338` | No wallet inbox or share-link entry path. Added incoming/outgoing Offered scans with older-page traversal, role-specific actions, query parsing/lookup and event-derived sharing. Inbox/link acceptance, cancellation, pagination, clipboard success/failure and reload passed. |
| High, status integrity | `web/src/chain.ts:148`, `web/src/App.tsx:253` | An unrelated read failure could erase valid mint data; the network dot was unconditional. Isolated subsystem results, removed raw mint debug values, gated the positive health indicator and added terminal unavailable copy. Controlled mint/Core/wiring failures passed; real open-mint reads rendered correctly. |
| Medium, freshness | `web/src/App.tsx:67` | Ownership/Stamina could remain stale after refreshing the main snapshot. Explicit refresh now advances the wallet read to the latest cached snapshot, and writes invalidate affected discovery/inbox/race queries. The wallet query stays stable while a large collection scan completes. Changed Stamina/owner/account cases reloaded correctly. |
| Medium, race guidance | `web/src/Racing.tsx:131`, `web/src/Racing.tsx:768` | Race actions lacked a stepper and relied on Core availability for independent block/time gates. Added explicit progress, TTL/remaining time and snapshot-based capture/settlement/expiry boundaries. Target, target+256, +15s, saved-seed/Core-outage and release scenarios passed. Closed races have no active step. |
| Medium, Core | `web/src/App.tsx:792` | A zero genesis pin had no direct CTA. Added simulated permissionless pinGenesis independent of game wiring, plus disconnected Connect wording. Connected unpinned-to-pinned transition passed; disconnected label source-reviewed. Frontier/lag remain actual reads. |
| Medium, offline recovery | `web/src/Invites.tsx:9`, `web/src/Invites.tsx:383` | Empty config guessed a relative API; invalid/missing service responses could obscure readiness. Empty now explicitly means offline, with bounded requests, response validation, terminal board state and Retry. Offline and configured-local board scenarios passed. |
| Medium, layout | `web/src/style.css:1577`, `web/src/style.css:1750` | Added racing shortcut needed room on the first phone screen; extreme match IDs could form unbreakable text. Final mobile meadow uses 3:1, panels align to start, race text wraps anywhere and race headings use 1.4 line-height. First-screen, five-width and maximum-ID checks passed. |

The existing explicit-open wallet guard was preserved and verified; no unsupported claim is made that a new wallet bug was reproduced. The managed browser tool returned **Transport closed**. Browser rendering, screenshots and interaction checks were completed using the provided Playwright Chromium directly instead.

## Evidence and limitations

Retained screenshots are current [play at 390](screenshots/play-390.png), [play at 1440](screenshots/play-1440.png), [offline invite form](screenshots/invite-390.png), [explicitly configured local empty invite board](screenshots/invite-board-empty.png), [fixture wallet keyboard focus](screenshots/wallet-keyboard-fixture.png) and [phone sheet](screenshots/wallet-phone.png). The local board image is not evidence of a deployed backend. Screenshots were visually inspected; phone rendering is Chromium emulation, not a physical iPhone test.

Full scratch evidence includes race rival/stepper states, the maximum-ID case, controlled responsive states, public-chain renders and both probe runs. Scratch is disposable and not required at runtime. [Check summary](check-results.json), [byte/path budget](bundle.md), and [final design system](../DESIGN.md) remain supplied.

Live challenge/accept/settlement, native wallet apps/passkeys, native zoom, screen readers and public invite registration/credit were not performed. Cooldown/quota enforcement stays with unchanged MatchBook simulation and is source-reviewed rather than fully modeled in browser fixtures. The service's own six tests cover its existing signature/receipt logic; a public service URL and its operation remain absent. Solidity tests were not rerun for this `none`-profile frontend task. These limits do not fabricate a live result or certified physical work.
