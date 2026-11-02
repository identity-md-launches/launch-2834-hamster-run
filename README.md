# HamsterRun

A pixel pastel Sepolia game: mint a free HAM, book six-round training, challenge another hamster, and invite friends. **Independent testnet demo only.** No official Squeek mining rights, real SQK, sensors, insurance, or transferable points.

The current website is in `web/`; the complete static export is in `dist/`. It uses the six live contracts from the pinned deployment receipt on chain **11155111**, with the exact previous demo ABIs. `web/src/deployment.json` records the addresses, source commit and expected ABI hashes. The earlier Solidity implementation and `demo/` remain intact. This website task broadcasts no transactions and changes no contracts.

## Install, preview and rebuild

Use Node 24 or newer and npm. From the repository root:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm run check:abis --prefix web
npm run build --prefix web
npm run preview --prefix web -- --port 4173
```

Open `http://localhost:4173`. The production build writes **root `dist/`**, including `index.html`, local fonts, illustrations, wallet marks, favicon, share image and configuration. Vite uses `base: './'`; asset URLs are relative and navigation uses hashes. Serve the whole export at any static gateway subpath. No CDN, package registry, secret, or backend is needed to render the site or read/play the on-chain game. RPC access and a visitor-approved Sepolia wallet are needed for game actions. The publisher serves the supplied export; it need not rebuild.

`npm run dev --prefix web` starts source development. `demo/` is the historical vanilla-JavaScript demo and still has its historical deployment-pending configuration; use `dist/` for this delivery.

## Playing honestly

- Connect through the single wallet control. Desktop extensions are discovered by EIP-6963. Phone browsers offer MetaMask, Coinbase Wallet, Rabby and Phantom deep links. Coinbase Wallet can also offer a passkey wallet. No relay or project ID is used.
- If `mintOpen` is false, the page says **“Mint closed / owner wiring pending”** and disables minting. Free means a **0 ETH price**, with Sepolia gas still required. `publicMinted` enforces the lifetime one-mint allowance, even after transferring away a HAM. Unknown mint state also disables the action. On-chain code and owner wiring are read before writes are enabled.
- Select an owned HAM. The NFT is not enumerable, so ownership is scanned in bounded RPC batches at one snapshot block; only confirmed owners and Stamina values are displayed. Large wallets/collections can take longer to load.
- Choose six wholly future rounds in the current genesis-aligned day. Booking is permanent for that HAM/day. Inspect earlier Core days to settle old bookings. A persistent, non-dismissible status banner appears on every view. Uncertified work is **unknown**, never zero. Pause or pin-check failure disables training settlement. Booking/racing do not invent certified work.
- A 1v1 challenge locks the challenger; acceptance locks both HAMs. Same Stamina band, different owners, five accepted races per HAM and wallet per week, and a 24-hour rematch cooldown apply. Share the displayed match ID; the other owner loads and accepts it. Capture the seed promptly, settle after the future block and 15-second minimum, or release an eligible expired race. All these calls go through the visitor’s wallet.
- The on-chain weekly score is **`trainWork + floor(summed raceDistance / 100)`**. It is distinct from wallet points and the off-chain invite board. A finalized week can exclude uncertified trains after the contract’s two-week grace; those bookings can still train their NFTs later.

## Persistent off-chain invites

A static gateway cannot share invite counts on its own. A small **Node + SQLite service is included**, with no signing key, paid account, new contract, or third-party database required. It stores handle registrations, expiring signature challenges and verified mint credits. The committed site does not pretend this service is deployed: without it, links can be created, but registration/credit and the shared board show an explicit unavailable state.

For a complete local site and invite service, after installing and building:

```sh
npm run service --prefix web -- --port 8787 --static ../dist
```

Open `http://127.0.0.1:8787/`. The same server serves the production export and `/api`. Its database is `web/service/data/invites.sqlite`, excluded from Git. Preserve that database and its SQLite sidecars when operating or backing up the service. To choose durable storage and a different port:

```sh
npm run service --prefix web -- --port 8787 --db /tmp/hamsterrun-invites.sqlite --static ../dist
```

For a separately hosted service, configure the public HTTPS API base in `web/public/site-config.json` as `inviteServiceUrl`, then rebuild. Empty means `./api` relative to the site. Pass the actual site origin to the service with `--origin`; multiple origins are comma-separated. The service also accepts `--host`, `--port`, `--db`, `--static` and an optional `--rpc` URL. Run it behind your chosen HTTPS ingress. Hosting and a production domain are outside this delivery; no invented endpoint or credential is embedded in the export.

Invite sequence:

1. Enter an X handle. One leading `@` is stripped; letters become lowercase; only 1–15 letters, numbers and underscores are allowed. Handles are **self-reported, not X-verified**. Connect and sign a five-minute, one-use registration message. One wallet registers one immutable handle.
2. Copy the generated link or open the X compose intent. Links use the current site’s real URL, preserve its gateway subpath, remove other query/hash state, and append `?ref=handle`. The site never posts automatically.
3. A visitor arriving with that query mints. After two receipt confirmations, the site requests a free signature binding the minting wallet, referrer, transaction, chain, collection, site, nonce and expiry. The backend verifies the signature and the real Sepolia receipt, checks the HAM mint event, checks `publicMinted` changed from false to true across the receipt block, and checks the canonical block hash. This also accepts a bundled smart-wallet mint; an owner mint or transfer alone is ineligible.
4. SQLite transactions and wallet uniqueness allow one credit per minting wallet and reject self-referrals by wallet address. Multiple wallets may legitimately mint in one bundled transaction. Requests replay safely; failed or unconfirmed mints do not count. The leaderboard ranks actual recorded counts descending, then handle alphabetically. No sample players are shipped.
5. If the service or signature is unavailable after mint, the mint remains successful. A **local retry receipt**, not a leaderboard or shared count, is saved for that wallet. Open Invite friends and use “Save invite credit” to retry. An unknown referrer must register before credit can be saved.

The service verifies at least two confirmations and retains receipt block hashes. It is a small demo service, not a chain indexer: deep reorg reconciliation and multi-region replication are not automated. POST requests are limited to 40 per direct client IP per minute; CORS allows only the service’s origin or explicitly configured origins. No private key or on-chain authority lives in the service.

## Checks and review

Actual outcomes, screenshots, six-domain Better Interface coverage, fixes and unperformed checks are in [artifacts/validation.md](artifacts/validation.md). The implemented visual system is in [DESIGN.md](DESIGN.md).

- Production build, TypeScript check and all six canonical ABI hashes: **passed**.
- Persistent invite service tests: **6/6 passed**, including signature/replay protection, once-only attribution, self-referrals, receipt validation and restart persistence.
- Browser interaction checks: **22 passed** on the production export, including mint/referral handoff, training frontier/paused states, 1v1 settlement, exact weekly score, signed handle registration, and wallet/network/error recovery. These writes use explicit controlled RPC/wallet fixtures; they are not live transactions.
- Design probe: **16/16 passed**, both online and offline, at 320, 390 and 1440. Additional responsive checks cover 760 and 1080. Play and invite axe scans returned zero violations in the tested states.
- Live read observed Sepolia supply 0, closed mint and a delayed Core frontier. The owner still controls mint opening; this build does not open it or wait for upstream certification.
- WebKit could not launch because system libraries are missing. Physical wallets, a real Coinbase passkey session, native zoom and screen readers were not exercised. The tool-managed browser could not locate Chrome; rendered checks used a separately installed Playwright Chromium.

Re-run the service checks without a browser or live chain:

```sh
npm run test:service --prefix web
```

To repeat browser validation with tools installed outside the repository:

```sh
npm install --prefix /tmp/hamsterrun-checks playwright @axe-core/playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/hamsterrun-browsers /tmp/hamsterrun-checks/node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/hamsterrun-browsers node web/scripts/validate-browser.mjs --playwright /tmp/hamsterrun-checks/node_modules/playwright/index.mjs --axe /tmp/hamsterrun-checks/node_modules/@axe-core/playwright/dist/index.mjs
```

The script owns its temporary server/browser for one foreground run and writes only to `test/scratch/interaction/` by default. Fixture accounts are generated in memory for validation, never shipped in application configuration. Browser checks need the production export and installed `web/` dependencies. The pinned taste probe was run separately; its inputs are removed by the assignment after submission.

The new `web/.gitignore` has an explicit path budget: the ignore file is under 1 KiB; `web/node_modules/`, `.vite/`, `.cache/`, `coverage/`, `service/data/` and `*.tsbuildinfo` have **zero submitted bytes**. The root ignore file only adds explicit, bounded exceptions for the retained reports and six screenshots; its path budget is recorded in that file. Root build/dependency configuration was not changed. [artifacts/bundle.md](artifacts/bundle.md) records the source/export budget. Required source, local assets, manifest, lockfile and export remain included.

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
