# HamsterRun

A pixel pastel Sepolia game: mint a free HAM, train, and challenge another owner. **Independent testnet demo only.** No official Squeek mining rights, SQK yield, sensors, insurance, or transferable points.

The React/TypeScript site is in `web/`; the complete static export is at root `dist/`. This revision keeps the deployed Sepolia contracts and their ABIs unchanged. Runtime addresses, RPCs and chain metadata load from `dist/imd-deployment.json`, copied from the pinned deployment/network handoff. All six canonical ABI hashes match that handoff. The read provider's chain and all six contracts' code are checked before writes are enabled.

## Install, preview and rebuild

Use Node 24 or newer and npm, from the repository root:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm run check:abis --prefix web
npm run build --prefix web
npm run preview --prefix web -- --port 4173
```

Open `http://localhost:4173`. `npm run dev --prefix web` starts source development. Vite builds root `dist/`, uses `base: './'`, bundles local fonts/illustrations/wallet marks, and uses hash navigation. Serve the whole export at a static gateway subpath; no server rewrites or CDN assets are required. Keep `imd-deployment.json` and `site-config.json` beside `index.html`. The publisher serves the delivered export without rebuilding it. The historical `demo/` is preserved; use `dist/` for this site.

The task's protected manifests and dependencies were left unchanged. For this worker's checks, the unchanged `web/package.json` and lockfile were installed in a temporary build copy; the exact source was mirrored there, the normal scripts ran, and its complete production export was copied back to `dist/`. No dependency directory or cache is included in the submission.

## Challenge and accept

1. Connect explicitly using the header control or a game Connect action. EIP-6963 discovers desktop extensions; phones offer MetaMask, Coinbase Wallet, Rabby and Phantom browser links plus Coinbase Smart Wallet. The sheet stays closed on initial load. A wrong-chain wallet gets **Switch to Sepolia**; transactions require chain **11155111** and Sepolia gas.
2. Select an owned HAM. **Find a rival** jumps to the race panel. Rivals have another owner, no match lock, and the same band `floor(min(Stamina, 9999) / 2000)`. Display labels count bands 1–5; the ranges are 0–1,999, 2,000–3,999, 4,000–5,999, 6,000–7,999 and 8,000–10,000. In particular, 10,000 belongs to the top band.
3. Choose **Challenge** beside a rival. Ownership, Stamina and locks are rechecked; simulation enforces the contract's five accepted races per HAM/wallet/week and 24-hour pair cooldown. The wallet confirms one existing MatchBook challenge transaction. Only the challenger locks during the offer.
4. After confirmation, the site reads the `Challenged` event, opens the match, updates `?match=<id>#play`, and attempts to copy both the ID and full link. Clipboard permission can be refused after wallet confirmation; a selectable link and **Copy match ID & link** provide recovery.
5. **Pending challenges** lists this wallet's incoming and outgoing Offered matches. The invited owner selects **Accept**; the challenger selects **Cancel**. A shared `?match=<id>` link also opens the race directly, with an explicit Connect action if needed. The lookup accepts a number or a complete link. Transferred targets, changed bands, limits and cooldowns remain subject to fresh transaction simulation.
6. The stepper shows **Offered → Accepted → Save seed → Settle**. Offers have a **1h TTL**, and acceptance also ends at week rollover. Acceptance locks both HAMs and selects **acceptance block +2**. Save the hash in blocks `target+1` through `target+256`, inclusive; it is unavailable in the target block itself. Settlement additionally requires **at least 15 seconds** after acceptance. These gates use the latest read block/timestamp, not a guessed browser timer. Settle can capture an available hash itself; a saved seed remains usable after the capture window, including during a Core read failure. An unsaved hash after `target+256` can only expire. The creator can cancel an unaccepted offer; anyone can release it after its full TTL. Accepted races cannot be cancelled.

Discovery scans 80 minted IDs per page at one snapshot block, with bounded concurrency. The checked range and **Check more HAMs** make partial coverage explicit. The inbox checks the newest 60 race IDs per page and offers **Check earlier matches**; it does not silently claim a complete scan of a large history. Both lists have retry states. Rival availability polls every 30 seconds, the inbox every 15 seconds, and the main snapshot every 12 seconds; confirmed writes invalidate all affected queries. No indexer, auto-queue, new MatchBook, mainnet flow or live transaction is supplied by this task.

## Core, mint and training

Mint, Core and game wiring have separate read results. A Core or wiring error cannot erase successfully read mint supply/availability. Failed mint reads show **Unavailable** and disable mint; the Sepolia health dot only turns green after the required reads succeed. It describes reads being online, not certification being caught up. The mint panel uses Open/Closed/Unavailable rather than raw `mintOpen` debug text.

When `CoreReader.genesisTimestamp == 0`, the banner offers permissionless **Pin genesis** (or **Connect to pin genesis**). It simulates `pinGenesis()` and never invents a genesis value. The CTA does not depend on completed game wiring. An unreadable pin state is not guessed to be zero. Once pinned, the banner continues to show the actual frontier, current round and unknown closed-round lag. A pin does not certify work.

Training retains the existing six-round, wholly future, current-day booking flow. Stamina comes only from certified delta cumulative physical work. Uncertified rounds remain **Unknown**, never zero; pause and failed identity checks defer settlement. There are no alternative Core addresses or invented work estimates. Refreshing Sepolia also refreshes wallet ownership/Stamina from the new snapshot. Background wallet polling uses a stable query every 30 seconds so a large collection scan can finish. The weekly score remains `trainWork + floor(summed raceDistance / 100)`, separate from address points and invite mints.

The public read-only smoke check observed open minting and one HAM minted, with a pinned but lagging Core. These are observations at the block recorded in `artifacts/chain-preflight.json`, not promises about subsequent chain state. No live mint, challenge, acceptance, settlement, pin or owner action was sent.

## Invite service: explicitly offline until configured

The provided and hosted `site-config.json` both have an empty `inviteServiceUrl`. No real public service URL was supplied. This export therefore shows the invite service and board as **offline** immediately after reading configuration. It does not guess `./api`, spin indefinitely on Loading, invent players, or claim registrations/counts are saved. Local share links can still be created; registration and attribution require the service.

To enable a real service, set `web/public/site-config.json`'s `inviteServiceUrl` to its **actual absolute HTTPS API base**, then rebuild. HTTP is allowed only for explicit localhost/127.0.0.1 development. Configuration requests time out after 8 seconds; API requests after 12 seconds. Invalid JSON, unhealthy responses and malformed leaderboard data produce recoverable offline/error states. Failed boards stop automatic polling and expose Retry.

The existing Node + SQLite service is retained, with signature-bound registration/attribution, persistent mint credits, replay/self-referral protection and canonical Sepolia receipt checks. It needs no private signing key or new contract. For local development, explicitly set the config URL to `http://127.0.0.1:8787/api`, rebuild, then run:

```sh
npm run service --prefix web -- --port 8787 --static ../dist
```

Open `http://127.0.0.1:8787/`. Preserve `web/service/data/invites.sqlite` and its sidecars. `--db` chooses another durable file, `--origin` declares allowed site origins, and `--host`/`--port`/`--rpc` configure the listener/public verifier. Production operation needs the service's real HTTPS ingress and CORS origin; this task does not publish or operate one.

Handles remain self-reported, not X-verified. `?ref=handle` attribution requires a registered referrer, a successful public mint and the minting wallet's free signature. Invite failure never reverses minting; the wallet can retry a pending credit on Invite friends. Credits are once per minting wallet and give no on-chain rewards. The existing service does not automate deep-reorg reconciliation or multi-region replication.

## Validation

See [artifacts/validation.md](artifacts/validation.md) for actual results, six-domain Better Interface coverage, fixes and limitations, and [DESIGN.md](DESIGN.md) for the final tokens/components/responsive behavior.

The production build, TypeScript check, all six ABI hash checks, and six invite-service tests passed. The controlled production-browser suite passes 26 scenario groups and two zero-violation axe scans covering rival filters/pagination, challenge/copy, both acceptance paths, inbox pagination/cancellation, exact hash/TTL boundaries, maximum-ID reflow, pin/mint/Core failures, training certification, phone wallet choices and five responsive widths. Transaction paths use explicit test RPC/wallet fixtures; no test account or fixture state is in the application bundle. Public-chain checks are read-only and separate.

```sh
npm run test:service --prefix web
PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node web/scripts/validate-browser.mjs --playwright /opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs
NODE_USE_ENV_PROXY=1 PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node web/scripts/inspect-live.mjs --playwright /opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs
```

The browser module paths above identify the assignment's provided tools; elsewhere supply your own installed Playwright path/browser location. Both scripts own their local subpath preview and Chromium for one bounded foreground run, write disposable evidence under `test/scratch/`, and close them. The pinned taste probe is run from the repository root before delivery, at 320/390/1440 plus reduced motion, with the results recorded in validation. Those pinned inputs are removed after the assignment.

The build emits the existing nonfatal transitive `ox/tempo` warning about browser externalization of `node:worker_threads`. Real Coinbase passkey setup and wallet apps are not exercised. The managed browser tool returned “Transport closed”; rendered validation uses the provided Playwright Chromium directly. No screen-reader session, physical-device test, native 200% zoom, RTL/localization expansion or full accessibility certification is claimed. The contribution byte audit is in [artifacts/bundle.md](artifacts/bundle.md); protected files, ignore files, contract sources and Solidity tests are unchanged.

## Contract development (preserved)

The Solidity sources, Foundry configuration, original tests and launch handoff remain unchanged by the website work. Their historical validation is [docs/VALIDATION.md](docs/VALIDATION.md), separate from this website’s checks. To work on those contracts independently, use `forge build`, `forge test` and `forge fmt --check`. `python3 tools/export-abis.py` regenerates the historical `demo/abis.json` after a deliberate contract build; it is not needed to rebuild this site.

## Contract graph

The check results and coverage are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

| Contract | Responsibility | Admin |
| --- | --- | --- |
| `CoreReader` | Pinned V3 identity for work reads, write-once pinned genesis for the calendar, frontier/pause checks, exact endpoint work delta | None (permissionless `pinGenesis`) |
| `HamsterRunNFT` | ERC-721, 10,000 cap, free public mint, owner demo mint, Stamina, race transfer locks | Explicit owner; two-step handover |
| `PointsLedger` | Non-transferable address counters and award events | Explicit owner; one-time writer wiring |
| `SeasonBoard` | Work and race components, top ten, pending activity, finalization and point tiers | Explicit owner; one-time book wiring |
| `TrainBook` | One future six-round window per NFT per day; permissionless certified settlement | None |
| `MatchBook` | Direct challenges, Stamina bands, future block randomness, quotas and expiry | None |

All six application contracts are immutable, use no delegatecall, and have nonpayable constructors with static arguments and no external calls. See [LAUNCH.md](LAUNCH.md) for constructor order and exact parameters. `script/Deploy.s.sol` rehearses the same graph locally; its printed simulation addresses are not launch addresses.

## Game rules and chosen parameters

**Calendar.** Round 1 begins at Core genesis. For timestamp `t >= genesis`, current round is `floor((t-genesis)/600)+1`; day is `floor((t-genesis)/86400)`; week is `floor(day/7)`. Day and week indices start at zero. These are genesis-aligned periods, not local midnight or ISO weeks. The verified genesis is 1791847800 (23:30 UTC on 2026-10-12), so days currently turn at 23:30 UTC and weeks every seven such days.

The genesis never changes for the Core stream, so `CoreReader` pins it once: the first identity-checked read through `pinGenesis()` (called by every booking, challenge and acceptance, and callable by anyone) stores it and emits `GenesisPinned`. From then on the clock, day, week and `weekEnd` are computed from the pinned value without consulting the live implementation, so a later Core proxy upgrade cannot stop booking, racing or finalizing. Work reads (`windowWork`) remain identity-checked and fail closed; after an upgrade they also check that the live genesis still equals the pinned one. Before anything is pinned, every read fails closed exactly as before.

**Mint.** Public minting starts closed and can be opened by the owner after configuration. Minting is free: one lifetime public mint per address. Transferring away an NFT does not reset this allowance. The owner may mint 1–50 NFTs per call for demos, under the same hard supply cap. No burn or cap-reset function exists. Stamina starts at zero.

**Train.** Only the current NFT owner can `book(tokenId, startRound)`. All six rounds `[r,r+5]` must be in the current day, and `r` must be strictly greater than the current round. This prevents retroactive selection using known partial work. The last possible start is `day*144+139`. Booking cannot be replaced, cancelled, or duplicated through a transfer. A day without a booking earns no training. Multiple days may remain pending during upstream lag.

Anyone can `settle(tokenId, day)` once the upstream frontier covers the end and Core is not paused. Work is exactly:

```text
roundPage(r+5, r+5, 0).end.cumulativeWork
  - roundPage(r-1, r-1, 0).end.cumulativeWork
```

Both point reads must certify the exact requested endpoint, have no records, and agree on their start/end work. Decreasing totals, impossible frontiers, or work greater than six times Core's per-round maximum revert. Difficulty and block units never enter the calculation. Each NFT independently uses the same public physical-work history; the work is a game input, not an exclusive allocation of physical effort.

For work `W` and Stamina `S`, gain is `min(10000-S, floor(200*W*1000 / ((W+1000)*(1000+S))))`. It saturates in work and diminishes with existing Stamina. Certified `W=0` always gives exactly zero gain. Tiny positive work can round down to zero; there is no forced minimum. Stamina is capped at 10,000. Settlement applies the formula to the NFT's **current** Stamina, so settling pending days in different orders may change rounding and gains. Training and Stamina follow the NFT on transfer; the week's prize recipient does not change.

**Race.** Direct challenge/accept is the v0 matchmaking mechanism; no automatic queue is required. Both owners must differ and both NFTs must occupy the same band `floor(min(Stamina, 9999)/2000)`, checked at challenge and acceptance. There are exactly five bands (0–1999, 2000–3999, 4000–5999, 6000–7999, 8000–10000); the exact cap belongs to the top band and does not form a band of its own. The challenger is locked during the offer; an unsolicited offer never locks its target. The offer ends after one hour and cannot be accepted in a different week. The challenger can cancel an unaccepted offer; anyone can expire it after the hour. A transferred target invalidates acceptance unless the original target owner owns it again.

Acceptance snapshots both owners, both Stamina values, and the week. It locks both NFTs and consumes **five accepted races per NFT AND wallet per week**, including races that later expire. Rematches require **24 hours** for both the unordered NFT pair and unordered wallet pair, measured from acceptance. Later training does not alter a race's snapshot. Accepted races cannot be cancelled or transferred away.

The randomness block is `acceptance block + 2`. Anyone may capture its hash in blocks `target+1` through `target+256` inclusive. Seed is `keccak256(abi.encode(blockhash(target), chainid, MatchBook, matchId))`. Distinct domain tags derive each runner's noise and a tie-break bit. A saved seed never changes. Settlement needs at least **15 seconds** plus the future block; actual chain confirmation adds latency. The demo can replay the recorded result over 15 seconds.

```text
distance(S, noise) = 10000 + floor(2000*S/(S+200)) + noise
noise is in [0,9999]; derived independently for each runner
```

For uniform independent noise and bonus difference `d`, win probability including half of ties is `0.5 + d/10000 - d²/(2*10000²)`. The global bonus difference is at most 1960, giving about **67.68%**, with smaller advantages inside most bands. An underdog can always win. Equal Stamina is symmetric. Modulo bias from 256 bits is negligible. This mathematical expectation assumes unbiased entropy; validators can influence block hashes, so this is only a free, no-stakes testnet demo.

The winner receives **+2 Stamina** (capped) and **10 address points**; the other wallet receives **1 participation point**. Both distances count on the board. Anyone can settle, including a nonparticipant. After `target+256`, an unsaved race can only expire, unlocking NFTs and decrementing the board's pending count without a result or points; quotas and cooldowns remain consumed. With a saved seed, settlement remains available indefinitely. Save/settle/expiry of an already accepted race do not depend on Core being available.

**Weekly board.** `score = trainWork + k * raceDistance` with the published conversion **k = 1/100** (`RACE_UNITS_PER_POINT = 100`): **1 score point per certified physical work unit** and **1 score point per 100 game race units**, applied to the week's summed race distance and rounded down. Both racers' distances are recorded, so one race is worth 100–219 points whether won or lost, and the five weekly races together are worth at most 1,097 points. For comparison, the live Core has certified about 453 work units per six-round window on average and at most 3,226 in any window, so a week of daily training (about 3,171 typical, 22,582 at the best observed rate) decides the tiers and racing is a secondary contribution. No physical equivalence between race units and work is claimed. Late settlement is attributed to the original booked/accepted week. Scores only increase. A bounded top-ten list is maintained on each update; smaller NFT IDs break exact score ties. A zero-score NFT receives no place.

Anyone can finalize after the week ends once **all accepted races have resolved** (anyone can expire a race whose block hash was never saved) and **all booked trains have settled**. Because settlement waits for Core certification, which has lagged by days on the live upstream, a single uncertified booking would otherwise hold every other player's prizes for that week indefinitely. Therefore, after the week end plus the published grace `FINALIZE_GRACE = 2 weeks`, finalize may proceed with bookings still pending. Those bookings are **excluded, never zeroed**: they get no board score, `SeasonFinalized(week, unsettledTrains)` reports how many were excluded, and when the Core later certifies them `settle` still applies the Stamina gain to the NFT and emits `LateTrainExcluded`. No admin can erase pending work, zero a booking or close a week early. Finalized score tables cannot change. Point-tier testnet prizes are 300 for rank 1, 150 for ranks 2–3, and 50 for ranks 4–10. Anyone can claim once per winning NFT/week, paid to the wallet that owned that NFT at its **first registered activity that week**, even after a transfer. This prevents prize redirection by a later buyer; buyers must inspect `entries(week,tokenId).beneficiary`.

**Points.** `points(address)` and `totalPoints()` are counters. There are no transfer, approval, redemption, or token functions. Ownership changes do not move points. `PointsAwarded` events support later indexing or a snapshot at a chosen finalized Ethereum block. No snapshot time, airdrop amount, eligibility promise, token launch, or financial entitlement is created here.

## After launch

The launch owner is `0xBFB53C8E9518bA748e94Ae075E2bE561d9BAC472`. Dependency addresses come only from the network's confirmed receipt, never from the local rehearsal. No outside signer, sensor, or oracle subscription is required.

| Setting | Setter / responsibility | Value and source |
| --- | --- | --- |
| NFT writers | Owner calls `HamsterRunNFT.configureBooks(train, match)` once | Confirmed TrainBook and MatchBook addresses |
| Points writers | Owner calls `PointsLedger.configureWriters(match, board)` once | Confirmed MatchBook and SeasonBoard addresses |
| Board writers | Owner calls `SeasonBoard.configureBooks(train, match)` once | Confirmed TrainBook and MatchBook addresses |
| Public mint | Owner calls `HamsterRunNFT.setMintOpen(true)` | Open after all three links and Core identity pass verification |
| Genesis pin | Anyone calls `CoreReader.pinGenesis()` once (recommended for the owner right after launch) | No argument: the value is read from the pinned V3 Core and must equal the verified genesis 1791847800. The first booking, challenge or acceptance pins it anyway |
| Demo addresses | Site operator updates `demo/deployment.json` | All six addresses from the confirmed Sepolia receipt; retain chainId 11155111 |
| Optional demo supply | Owner calls `ownerMint(recipient,quantity)` | Actual participating recipient; quantity 1–50 |

`node tools/owner-actions.mjs <confirmed-deployment.json>` prepares the four unsigned configuration transactions without reading a key or sending anything. It refuses missing/zero addresses. The owner's wallet executes them after reviewing the receipt. Configuration is one-time; incorrect wiring requires a new deployment. The one-time wiring breaks the dependency cycle among writers and their targets without constructor-time calls.

The owner maintains public mint availability and may hand ownership over in two steps. Volunteer keepers or players settle training, save race hashes promptly, settle/expire matches, finalize weeks (after the grace period, with any still-uncertified bookings reported as excluded), and claim prizes. The site operator refreshes ABIs after any source rebuild and monitors RPC availability, Core identity, reorgs and certification lag. See [THREATS.md](THREATS.md) and [LAUNCH.md](LAUNCH.md).

## Upstream observation

At Sepolia block **12042124**, timestamp **2026-11-01 16:13:36 UTC**, the specified proxy reported V3, unpaused, current round **2837**, and frontier **1973**: **863 closed rounds were unknown**. A six-round historical endpoint read through the frontier returned a true certified zero delta. That historical observation is not credited to any game NFT. Fresh bookings require new future certification, so training on this exact upstream may remain pending until its reporter resumes. No alternative Core address is silently substituted.

The pinned observation is [docs/upstream/core-snapshot.json](docs/upstream/core-snapshot.json). Recheck with `python3 tools/verify-core.py`; it reads one block, verifies the implementation runtime hash, and checks the actual endpoint ABI. Default Foundry tests do not use a network.
