# HamsterRun

An independent, free Sepolia game with at most **10,000 ERC-721 NFTs**, named **Hamster run** (`HAM`). Its only v0 game attribute is **Stamina**. Training reads certified physical work from the specified SqueekCore V3 proxy. HamsterRun NFTs are separate from official Squeeks mining NFTs; there are no sensors, token rewards, SQK yield claims, entry fees, or assets held for players.

The implementation, offline tests, static demo, deployment rehearsal, and operational handoff are included. **Sepolia deployment and its confirmed addresses belong to the network launch step after acceptance. No worker transaction was broadcast and no HamsterRun addresses are invented.** The demo remains in an explicit deployment-pending state until the confirmed address set is supplied.

## Run locally

```sh
forge build
forge test
forge fmt --check
python3 tools/export-abis.py
python3 -m http.server 8080 --directory demo
```

Open `http://localhost:8080`. No npm install, CDN, network fork, environment variables, key, or filesystem permission is needed to build or test. The static page needs a Sepolia RPC connection for real chain reads and an injected wallet for user-approved transactions. Its ethers module and ABIs are included locally. `foundry.toml` pins Solidity 0.8.26, Cancun, optimizer 200, no metadata bytecode hash, and the task's fuzz seed (`0x39b28f5234281505aa1affaf6e899719917a539eef55a3027471750095572375`).

## Contract graph

The check results and coverage are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

| Contract | Responsibility | Admin |
| --- | --- | --- |
| `CoreReader` | Pinned V3 identity, clock, frontier/pause checks, exact endpoint work delta | None |
| `HamsterRunNFT` | ERC-721, 10,000 cap, free public mint, owner demo mint, Stamina, race transfer locks | Explicit owner; two-step handover |
| `PointsLedger` | Non-transferable address counters and award events | Explicit owner; one-time writer wiring |
| `SeasonBoard` | Work and race components, top ten, pending activity, finalization and point tiers | Explicit owner; one-time book wiring |
| `TrainBook` | One future six-round window per NFT per day; permissionless certified settlement | None |
| `MatchBook` | Direct challenges, Stamina bands, future block randomness, quotas and expiry | None |

All six application contracts are immutable, use no delegatecall, and have nonpayable constructors with static arguments and no external calls. See [LAUNCH.md](LAUNCH.md) for constructor order and exact parameters. `script/Deploy.s.sol` rehearses the same graph locally; its printed simulation addresses are not launch addresses.

## Game rules and chosen parameters

**Calendar.** Round 1 begins at Core genesis. For timestamp `t >= genesis`, current round is `floor((t-genesis)/600)+1`; day is `floor((t-genesis)/86400)`; week is `floor(day/7)`. Day and week indices start at zero. These are genesis-aligned periods, not local midnight or ISO weeks. The verified genesis is 1791847800 (23:30 UTC on 2026-10-12), so days currently turn at 23:30 UTC and weeks every seven such days.

**Mint.** Public minting starts closed and can be opened by the owner after configuration. Minting is free: one lifetime public mint per address. Transferring away an NFT does not reset this allowance. The owner may mint 1–50 NFTs per call for demos, under the same hard supply cap. No burn or cap-reset function exists. Stamina starts at zero.

**Train.** Only the current NFT owner can `book(tokenId, startRound)`. All six rounds `[r,r+5]` must be in the current day, and `r` must be strictly greater than the current round. This prevents retroactive selection using known partial work. The last possible start is `day*144+139`. Booking cannot be replaced, cancelled, or duplicated through a transfer. A day without a booking earns no training. Multiple days may remain pending during upstream lag.

Anyone can `settle(tokenId, day)` once the upstream frontier covers the end and Core is not paused. Work is exactly:

```text
roundPage(r+5, r+5, 0).end.cumulativeWork
  - roundPage(r-1, r-1, 0).end.cumulativeWork
```

Both point reads must certify the exact requested endpoint, have no records, and agree on their start/end work. Decreasing totals, impossible frontiers, or work greater than six times Core's per-round maximum revert. Difficulty and block units never enter the calculation. Each NFT independently uses the same public physical-work history; the work is a game input, not an exclusive allocation of physical effort.

For work `W` and Stamina `S`, gain is `min(10000-S, floor(200*W*1000 / ((W+1000)*(1000+S))))`. It saturates in work and diminishes with existing Stamina. Certified `W=0` always gives exactly zero gain. Tiny positive work can round down to zero; there is no forced minimum. Stamina is capped at 10,000. Settlement applies the formula to the NFT's **current** Stamina, so settling pending days in different orders may change rounding and gains. Training and Stamina follow the NFT on transfer; the week's prize recipient does not change.

**Race.** Direct challenge/accept is the v0 matchmaking mechanism; no automatic queue is required. Both owners must differ and both NFTs must occupy the same `floor(Stamina/2000)` band, checked at challenge and acceptance. The challenger is locked during the offer; an unsolicited offer never locks its target. The offer ends after one hour and cannot be accepted in a different week. The challenger can cancel an unaccepted offer; anyone can expire it after the hour. A transferred target invalidates acceptance unless the original target owner owns it again.

Acceptance snapshots both owners, both Stamina values, and the week. It locks both NFTs and consumes **five accepted races per NFT AND wallet per week**, including races that later expire. Rematches require **24 hours** for both the unordered NFT pair and unordered wallet pair, measured from acceptance. Later training does not alter a race's snapshot. Accepted races cannot be cancelled or transferred away.

The randomness block is `acceptance block + 2`. Anyone may capture its hash in blocks `target+1` through `target+256` inclusive. Seed is `keccak256(abi.encode(blockhash(target), chainid, MatchBook, matchId))`. Distinct domain tags derive each runner's noise and a tie-break bit. A saved seed never changes. Settlement needs at least **15 seconds** plus the future block; actual chain confirmation adds latency. The demo can replay the recorded result over 15 seconds.

```text
distance(S, noise) = 10000 + floor(2000*S/(S+200)) + noise
noise is in [0,9999]; derived independently for each runner
```

For uniform independent noise and bonus difference `d`, win probability including half of ties is `0.5 + d/10000 - d²/(2*10000²)`. The global bonus difference is at most 1960, giving about **67.68%**, with smaller advantages inside most bands. An underdog can always win. Equal Stamina is symmetric. Modulo bias from 256 bits is negligible. This mathematical expectation assumes unbiased entropy; validators can influence block hashes, so this is only a free, no-stakes testnet demo.

The winner receives **+2 Stamina** (capped) and **10 address points**; the other wallet receives **1 participation point**. Both distances count on the board. Anyone can settle, including a nonparticipant. After `target+256`, an unsaved race can only expire, unlocking NFTs and decrementing the board's pending count without a result or points; quotas and cooldowns remain consumed. With a saved seed, settlement remains available indefinitely. Save/settle/expiry of an already accepted race do not depend on Core being available.

**Weekly board.** `score = trainWork + 2*raceDistance`. The published conversion is **1 score point per physical work unit** and **2 score points per game race unit** (`RACE_WORK_WEIGHT=2`); no physical equivalence between race units and work is claimed. Late settlement is attributed to the original booked/accepted week. Scores only increase. A bounded top-ten list is maintained on each update; smaller NFT IDs break exact score ties. A zero-score NFT receives no place.

Anyone can finalize after the week ends and **all booked trains and accepted races resolve**. No admin can erase pending work or force an uncertified week closed. Core lag can therefore delay a board indefinitely. Finalized score tables cannot change. Point-tier testnet prizes are 300 for rank 1, 150 for ranks 2–3, and 50 for ranks 4–10. Anyone can claim once per winning NFT/week, paid to the wallet that owned that NFT at its **first registered activity that week**, even after a transfer. This prevents prize redirection by a later buyer; buyers must inspect `entries(week,tokenId).beneficiary`.

**Points.** `points(address)` and `totalPoints()` are counters. There are no transfer, approval, redemption, or token functions. Ownership changes do not move points. `PointsAwarded` events support later indexing or a snapshot at a chosen finalized Ethereum block. No snapshot time, airdrop amount, eligibility promise, token launch, or financial entitlement is created here.

## After launch

The launch owner is `0xBFB53C8E9518bA748e94Ae075E2bE561d9BAC472`. Dependency addresses come only from the network's confirmed receipt, never from the local rehearsal. No outside signer, sensor, or oracle subscription is required.

| Setting | Setter / responsibility | Value and source |
| --- | --- | --- |
| NFT writers | Owner calls `HamsterRunNFT.configureBooks(train, match)` once | Confirmed TrainBook and MatchBook addresses |
| Points writers | Owner calls `PointsLedger.configureWriters(match, board)` once | Confirmed MatchBook and SeasonBoard addresses |
| Board writers | Owner calls `SeasonBoard.configureBooks(train, match)` once | Confirmed TrainBook and MatchBook addresses |
| Public mint | Owner calls `HamsterRunNFT.setMintOpen(true)` | Open after all three links and Core identity pass verification |
| Demo addresses | Site operator updates `demo/deployment.json` | All six addresses from the confirmed Sepolia receipt; retain chainId 11155111 |
| Optional demo supply | Owner calls `ownerMint(recipient,quantity)` | Actual participating recipient; quantity 1–50 |

`node tools/owner-actions.mjs <confirmed-deployment.json>` prepares the four unsigned configuration transactions without reading a key or sending anything. It refuses missing/zero addresses. The owner's wallet executes them after reviewing the receipt. Configuration is one-time; incorrect wiring requires a new deployment. The one-time wiring breaks the dependency cycle among writers and their targets without constructor-time calls.

The owner maintains public mint availability and may hand ownership over in two steps. Volunteer keepers or players settle training, save race hashes promptly, settle/expire matches, finalize weeks, and claim prizes. The site operator refreshes ABIs after any source rebuild and monitors RPC availability, Core identity, reorgs and certification lag. See [THREATS.md](THREATS.md) and [LAUNCH.md](LAUNCH.md).

## Upstream observation

At Sepolia block **12042124**, timestamp **2026-11-01 16:13:36 UTC**, the specified proxy reported V3, unpaused, current round **2837**, and frontier **1973**: **863 closed rounds were unknown**. A six-round historical endpoint read through the frontier returned a true certified zero delta. That historical observation is not credited to any game NFT. Fresh bookings require new future certification, so training on this exact upstream may remain pending until its reporter resumes. No alternative Core address is silently substituted.

The pinned observation is [docs/upstream/core-snapshot.json](docs/upstream/core-snapshot.json). Recheck with `python3 tools/verify-core.py`; it reads one block, verifies the implementation runtime hash, and checks the actual endpoint ABI. Default Foundry tests do not use a network.
