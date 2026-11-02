# HamsterRun website validation

Worker report for the 2026-11-02 repository delivery. These are local results, not independent certification. The assignment’s verifier checks paths and bytes rather than browser behavior.

## Result and scope

**Complete for the stated repository/build scope**, with the external conditions below. Source, frontend manifest/lockfile, local runtime assets, root `dist/`, persistent invite service, design documentation and reproducible checks are included. No contract was changed or deployed, no owner action was performed, and no transaction was broadcast by the worker.

HamsterRun is a small Sepolia game carried visually by an original mint-green pixel meadow and chunky hamster characters. The design follows the requested visual direction rather than reproducing Fren Pet assets. The existing contracts/demo were preserved; the new React/TypeScript site lives in `web/`.

| Area | Result |
| --- | --- |
| Production build / TypeScript | Passed / passed |
| Pinned canonical ABI hashes | 6 of 6 matched |
| Invite service tests | 6 of 6 passed |
| Production-export browser scenarios | 22 passed |
| Product and primary action at 390px | Yes; play mint control and invite creation control are visible |
| taste@1 design probe | 16/16 online and 16/16 offline |
| axe accessibility scans | Zero violations in tested play and invite states |
| Required metadata / local share card | Present; PNG visually inspected |
| Applicable unresolved high findings | None observed in the tested scope |

The backend is supplied, not published. A static gateway alone displays honest service-unavailable states; running/configuring the provided Node service enables shared registrations, attribution and the leaderboard. Its SQLite data is persistent and excluded from the submission. Website hosting and backend operation are outside this repository task.

## Live chain observation

Read-only preflight at **Sepolia block 12045706**, recorded in [chain-preflight.json](chain-preflight.json):

- Chain ID 11155111; all six pinned addresses had nonempty deployed code. Runtime hashes are recorded as observations, not represented as an independent bytecode audit.
- `totalSupply = 0`, `mintOpen = false`; the UI disables mint and displays “Mint closed / owner wiring pending”.
- Owner book/writer wiring was incomplete. That does not claim which owner calls have occurred; the worker performs none.
- Core current round 2909, certified frontier 1973, **935 closed rounds unknown**, paused false, adapter configuration/pin check passed; Core day 20, week 2.
- `RACE_UNITS_PER_POINT = 100`, agreeing with the required weekly formula.
- All three supplied RPCs also returned Sepolia chain ID through viem. An initial Python HTTP attempt returned 403; subsequent viem and Chromium reads worked. No private configuration or alternate deployment was used.

These observations can change. The site re-reads the chain. Supply, mint availability, points, Stamina and scores are not seeded or synthesized. Actual public minting awaits the owner; a live training settlement also awaits upstream certification. We did not wait for either.

## Requirements coverage

| Brief requirement | Implementation / evidence |
| --- | --- |
| “HamsterRun”, pastel pixel UI | Local SVG art, Pixelify/Nunito, mint meadow, responsive game panels; screenshots below |
| Sepolia and named contracts / reused ABIs | `web/src/deployment.json`, `abis.json`, `chain.ts`; pinned hashes matched; live code/state reads |
| Connect wallet; mint flag, supply, owned IDs, Stamina, points | EIP-6963/Coinbase/mobile picker; live mint/supply; controlled owned-HAM and points reads after mint |
| Free once-per-wallet mint; MintClosed / MintLimit | Simulation, 0 value, two-confirmation receipt, `publicMinted`; both custom errors exercised |
| Future six-round training and certified settlement | Future/day boundary validation; unknown tiles and null unsettled work; pause/frontier guards; controlled certified settlement |
| Optional challenge/accept/settle | Two wallet identities, challenge ID, acceptance, 15-second/future-block guard, seed capture and settlement exercised |
| `trainWork + floor(raceDistance/100)` | Browser scenario verified `123 + floor(19999/100) = 322`; on-chain conversion read as 100 |
| X handle normalization and share URL | Format validation, strip `@`, lowercase, signed registration, copied complete subpath URL; X link opens a compose intent only |
| Persistent off-chain once-only attribution; no self-ref | Browser mint-to-signed-credit handoff; server tests cover replay, self-ref, concurrency, failed mint and restart persistence |
| Invite leaderboard separate from SeasonBoard | Browser showed the verified invite count in its own board; local unseeded service showed a genuine empty board |
| Persistent Core lag / paused / unknown banner | Non-dismissible banner on every view plus local booking states; all three states exercised |
| Complete static `dist/` and relative URLs | Export served successfully under `/preview/`; local assets and dynamic chunks resolved; hash navigation |
| Build/typecheck/interaction results and limitations | Commands and actual outcomes below; machine-readable [check-results.json](check-results.json) |
| Better Interface six-domain review / DESIGN / README | Coverage and fixes below; root `DESIGN.md` and README reflect final source |
| First screen at 390; title/favicon/description/OG | First-screen checks passed; local 1200×630 share PNG; metadata probe passed |
| Forbidden paths and 8 MiB limit | No contract/build/dependency baseline changed; new frontend stays under `web/`; [bundle.md](bundle.md) records the conservative added-file budget |

## Better Interface review

Applied the pinned workflow and core principles of all six domains while constructing and reviewing the site. The preserved guide licenses/notices are in `web/licenses/`. No extra theme, localization system, animation library or unrelated product feature was added to fill a checklist.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native links/buttons/forms/table/dialog; bound labels, inline errors, stable transaction status, skip link, complete wallet address, 3px focus, Escape/focus return; keyboard-focused wallet row inspected; axe zero violations. No screen-reader session, physical-device test or complete keyboard-only transaction signing session. |
| Layout | Checked | Real export at 320/390/760/1080/1440; mobile play/invite actions above the fold; no page overflow; normal-flow status and controls; local table overflow contained. Native browser 200% zoom, translation expansion and RTL not tested; site is English only. |
| Writing | Checked | Verb actions, Stamina/points/invites kept distinct, literal testnet/gas copy, actionable errors and honest empty/offline states. No fictional scores, players or certified work. |
| Typography | Checked | Two local faces loaded, weights 400/700, bounded per-width scale, tabular figures, 16px phone inputs, responsive wrapping and full address reachability. No operating-system font/rendering matrix. |
| Colors | Checked | Role tokens inspected; measured resolved pairs passed normal/large text thresholds. Page ink 10.74:1, muted 6.90:1, normal Core banner 7.35:1. Two image-associated text boxes were excluded by the probe; no contrast value is asserted for them. No dark theme. |
| UI | Checked | Rest, selected, wallet pending/rejection, empty, read failure, submitted/confirmed and game states exercised. Flat panels, distinct controls, native dialog, no endless motion, reduced-motion probe passed. Real wallet/passkey prompts, every hover background and 10%-speed animation-panel review were not performed. |

The probe reports six targets below its comfortable 44px size, mainly disclosure/refresh controls; none fails its 24px-or-spacing rule. This is recorded rather than presented as universal 44px coverage.

## Findings and corrections

All locations refer to final source. The evidence below distinguishes rendered findings from source/state checks.

| Severity / domain | Location and snippet | Observed issue → correction → recheck |
| --- | --- | --- |
| Medium, layout | `web/src/style.css:1173`, `.how-steps li` | Initial desktop probe treated tutorial number chips above headings as kickers. Moved the numbers beside the heading text without adding a surface. Final online/offline eyebrow checks passed. |
| Medium, writing | `web/src/chain.ts:381`, `const detail` | A rejected controlled wallet call surfaced “An unknown RPC error occurred.” Read nested error details and decode known errors across the reused ABIs. Rejection now has a clear retry; MintClosed/MintLimit scenarios passed without sending. |
| Low, typography | `web/src/App.tsx:301`, mint description | Hiding the desktop line break on mobile joined two words. Added explicit spacing after the break. Final live phone screenshot shows “wallet. Train”. |
| Medium, layout | `web/src/style.css:1454`, mobile `.invite-art > img` | The secondary illustration pushed the invite action below the first phone screen. Omitted that illustration at the existing mobile breakpoint. Local production inspection measured the button bottom at 783.375px in an 844px viewport; browser assertion passed. |
| Medium, writing | `web/src/App.tsx:338`, unavailable mint state; Core banner copy | Offline status could continue to read “Checking mint”; two short recovery sentences were also counted as slogans. Added a distinct unavailable action label and direct recovery copy. Read-failure scenario and final offline probe passed. |
| High, contract interaction | `web/src/App.tsx:76`, `canTransact` / `canWrite` | An unrelated incomplete game writer link could block an otherwise open NFT mint. Split mint eligibility from game-wiring eligibility and explain pending training/racing setup locally. Controlled open-mint/incomplete-wiring scenario passed, then enabling wiring enabled training. |
| Medium, wallet | `web/src/open-in.ts:17`, Rabby query | The initially assumed Rabby URL did not match the native handler. Corrected it to the handler’s `_cmd=open-dapp` / `dapp` form; source comment records the basis. Phone-link parameter checks passed. Native-device launch remains unperformed. |
| High, wallet | `web/src/Wallet.tsx:37`, `mobileOpen` | A phone EIP-6963 provider without legacy `window.ethereum` could be hidden behind Open-in links. Prefer the discovered native provider. A phone-context announcement now displays a connectable named row; scenario passed. |
| Medium, invite integrity | `web/service/store.mjs:21`, wallet primary key | Global uniqueness of a receipt hash would reject a second legitimate wallet in one bundled transaction. Enforce uniqueness by minting wallet while verifying each wallet’s mint proof. Service test credits two wallets sharing one receipt and still blocks double credit per wallet. |
| Low, navigation | `web/src/App.tsx:241`, home links | Source review found home links pointing at a fragment with no target. Used the native empty fragment for home links and the return-to-game action. The footer-home browser scenario returned to scroll position zero. |
| Low, share artwork | `web/scripts/generate-share.mjs`, image/header composition | Initial PNG cropped the large hamster’s body. Regenerated with the full characters and local typography visible; final PNG was visually inspected. |

Clipboard writing was initially denied by the automation context; the application displayed its manual-select/copy recovery. With explicit browser clipboard permissions, the copy-success path passed. No external message or X post was sent during validation.

The Rabby correction was inferred from its official [native universal-link handler](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/hooks/universalLink.ts) and [production link prefix](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/constant/universalLink.ts). That is source evidence, not a physical mobile-wallet test.

## Commands and actual outcomes

From repository root unless noted:

```sh
npm run typecheck --prefix web
npm run check:abis --prefix web
npm run test:service --prefix web
npm run build --prefix web
```

All exited 0. The six service tests cover normalization; signed registration/ownership/replay/self-ref; atomic once-only credits and restart persistence (including bundled receipts); nonce expiry/action binding; receipt success/chain/depth/recipient/public-mint/canonical-block checks; and failed-mint exclusion. Tests generate transient accounts in memory; none is configured in the app.

The final Vite build produced root `dist/`, roughly 1 MB with all assets. It emitted one nonfatal warning that transitive `ox/tempo` imports `node:worker_threads` and that module was externalized. The tested EVM flows rendered and completed; a real Coinbase passkey session was not exercised.

Browser tooling was installed outside the repository. These actual commands exited 0:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/hr-browsers node web/scripts/validate-browser.mjs --playwright /tmp/hr-test/node_modules/playwright/index.mjs --axe /tmp/hr-test/node_modules/@axe-core/playwright/dist/index.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/hr-browsers IMD_PLAYWRIGHT=/tmp/hr-test/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
PLAYWRIGHT_BROWSERS_PATH=/tmp/hr-browsers IMD_PLAYWRIGHT=/tmp/hr-test/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste-offline --offline
```

The first command manages its own foreground preview server and tests the **production export under `/preview/`**. Live reads are observed separately; transaction paths use explicit controlled EIP-1193/EIP-6963 and RPC fixtures, real signatures, and a real local SQLite service. It does not broadcast or impersonate live game activity. It produced 22 passing scenario groups, zero uncaught page errors/missing local resources, and two zero-violation axe scans.

The taste probes measured all 16 checks online and offline, including reduced motion. They are measurements of the initial view, not a substitute for the invite/race interaction checks. A separate foreground inspection used the provided service to serve `dist/`, read `/api/health`, observed an unseeded empty `/api/leaderboard`, confirmed both local fonts loaded, and captured the final screenshots. That inspection returned no page errors.

The managed browser tool itself answered `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`. A separate Playwright Chromium was installed and used successfully. WebKit installation completed but launching reported missing host libraries; no WebKit rendering result is claimed. There is no physical wallet, real passkey, screen-reader or native zoom result.

## Evidence retained

- [Play at 390 CSS pixels](screenshots/play-390.png), [play at 1440](screenshots/play-1440.png).
- [Invite creation at 390](screenshots/invite-390.png), [genuine empty invite board](screenshots/invite-board-empty.png). These use a local, unseeded service; they are not a claim that a public backend is deployed.
- [Wallet keyboard focus](screenshots/wallet-keyboard-fixture.png): explicitly controlled wallet-discovery fixture, not a real installed wallet.
- [Phone wallet picker](screenshots/wallet-phone.png): Chromium emulation, not a physical iPhone.
- [Machine-readable check summary](check-results.json), [live chain snapshot](chain-preflight.json), [bundle budget](bundle.md).

Full scratch probe screenshots/results were actually produced in `test/scratch/taste/`, `test/scratch/taste-offline/` and `test/scratch/interaction/`. Those directories are intentionally disposable and removed by the assignment; the retained files above are delivery evidence, not fabricated replacements.

## Remaining limitations

Public mint is currently owner-closed and game wiring is incomplete. The worker cannot and does not change those states. Future training work remains unknown until the named upstream certifies it. No live mint, live training settlement, live race or point claim was signed. The optional finalization/prize UI and expired-race release were source-reviewed but were not individually exercised in the browser suite; their contract preconditions remain authoritative.

Operating the supplied invite service and configuring its public HTTPS URL/CORS origin is required for shared production invite counts on static hosting. It has two-confirmation/canonical-block verification, but no automated deep-reorg reconciliation or multi-region replication. X handles remain self-reported. Actual wallet-app launches, Coinbase passkey setup and user-specific signature UX depend on those wallets and were not tested on devices.

No breeding, land, mainnet, SQK yield, transferable points, sensors, insurance, referral contract or alternate Core was added.
