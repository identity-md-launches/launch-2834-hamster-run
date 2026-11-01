# Sepolia launch handoff

**Status:** implementation and local rehearsal delivered; live HamsterRun deployment is performed by the IdentityMD network after acceptance. No signed transaction, funded wallet, key, attestation, or factory call is needed from the requester at this build step. There are no confirmed HamsterRun addresses yet. Do not publish local rehearsal addresses as Sepolia deployments. `demo/deployment.json` deliberately has an empty contract map until the deployment receipt exists.

The separate manifest step owns `launch.json`; this project does not supply one. The launch contains exactly these six application contracts, with no token launch, pool, proxy, deployment factory, badge contract or randomness service. Test fixtures and the rehearsal script are not launch applications.

## Constructor parameters in deployment order

All constructors are nonpayable, take at most four static ABI words, make no external calls, and accept dependency addresses even if those addresses do not yet have code. The owner is always **0xBFB53C8E9518bA748e94Ae075E2bE561d9BAC472**, represented as `$owner` by the manifest writer. All contract references point backward in this order.

| Order | Solidity name | Constructor arguments in declaration order |
| --- | --- | --- |
| 1 | `CoreReader` | `core_ = 0x74665dAecA35A2303e767E76a2FF1FB6F93e119f`, `implementation_ = 0x0a71C86ab63a77675002A389FDF4D096A07b11e2`, `runtimeHash_ = 0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d` |
| 2 | `HamsterRunNFT` | `owner_ = $owner` |
| 3 | `PointsLedger` | `owner_ = $owner` |
| 4 | `SeasonBoard` | `owner_ = $owner`, `nft_ = $contract:HamsterRunNFT`, `ledger_ = $contract:PointsLedger`, `reader_ = $contract:CoreReader` |
| 5 | `TrainBook` | `nft_ = $contract:HamsterRunNFT`, `reader_ = $contract:CoreReader`, `board_ = $contract:SeasonBoard` |
| 6 | `MatchBook` | `nft_ = $contract:HamsterRunNFT`, `ledger_ = $contract:PointsLedger`, `board_ = $contract:SeasonBoard`, `reader_ = $contract:CoreReader` |

Compile with the delivered root `foundry.toml`: Solidity **0.8.26**, Cancun, optimizer enabled with **200 runs**, `bytecode_hash = "none"`, no via-IR requirement, no linked external libraries, FFI, filesystem grants or remote imports. Do not deploy `Deploy`, `EmptyChainFactory`, `MockCore` or test contracts.

## Preflight and local checks

```sh
forge build
forge test
forge fmt --check
forge script script/Deploy.s.sol:Deploy
python3 tools/verify-core.py
```

The script above is a **local simulation**, with no `startBroadcast`, environment reads or signing. Its `deploy(owner,core,implementation,runtimeHash)` function is directly tested. Constructors also pass an empty-chain ownership/dependency rehearsal, and each application runtime is tested against EIP-170 and the protected floor's forbidden-opcode scan.

The Core preflight requires network read access. It checks chain ID, proxy code, reported V3 implementation, the implementation code hash, genesis/600-second round configuration, and actual certified endpoint decoding at a single block. The ABI is pinned in `docs/upstream/SqueekCore.v3.json`. Recheck immediately before launch; if the implementation changes, review rather than replacing the pin silently. The adapter cannot defeat a malicious upstream implementation that lies about its getters; see THREATS.md.

At the recorded block 12042124, Core was unpaused but its frontier lagged by 863 closed rounds. This affects the launch experience: a newly booked future window **cannot settle until the named Core certifies it**. No alternate Core is used. Race gameplay can operate with initial zero Stamina, but a fully demonstrated live training cycle depends on resumed upstream certification. Keep that banner and disclosure visible.

## Owner configuration after receipt

The factory only deploys bytecode. The named owner's wallet performs these nonpayable calls after all addresses exist. They are not unguarded initializers: only the explicit owner can execute them, only once, with deployed, distinct contract arguments.

1. `HamsterRunNFT.configureBooks(TrainBook, MatchBook)`.
2. `PointsLedger.configureWriters(MatchBook, SeasonBoard)`.
3. `SeasonBoard.configureBooks(TrainBook, MatchBook)`.
4. Read back all links, verify the application's sources/runtime and Core pin, then `HamsterRunNFT.setMintOpen(true)` if public minting is desired. Owner demo minting may instead supply actual participating wallets with `ownerMint(recipient, quantity)` (1–50).

Do not guess any receipt address. Place the confirmed values under the six Solidity names in the `contracts` object of `demo/deployment.json`, retain `chainId: 11155111`, and update its status to deployed. The contract map is also accepted by the demo's advanced deployment loader. This file is website configuration, not the launch manifest.

Run `node tools/owner-actions.mjs <confirmed-deployment.json>` to generate reviewable unsigned calls for steps 1–4. It refuses absent and zero addresses, performs no signing and sends no transaction. The owner should simulate and inspect those calls against the receipt; skip configurations already completed. If ownership was transferred, the current owner must act. One-time wiring cannot be overwritten, so a wiring mistake requires redeployment.

After source changes, regenerate the committed browser ABIs with `python3 tools/export-abis.py`. Serve `demo/` through HTTPS on a static host (localhost HTTP is suitable for rehearsal). No backend, build service, CDN or secret configuration is needed.

## Live acceptance walkthrough

1. Connect two separate Sepolia wallets to the demo. Each publicly mints one free HAM NFT, or the owner safely mints to the actual participants. Verify `ownerOf`, `name`, `symbol`, total supply and zero initial Stamina.
2. Select an owned NFT and book `[r,r+5]` within the current genesis day, where `r > currentRound`. Record NFT ID, day and window. A second booking in the same day must revert, including after an NFT transfer.
3. Inspect the frontier banner. Before `frontier >= r+5`, settlement must revert `UnknownRounds`; if Core is paused it must revert `CorePaused`. The booking remains unsettled and weekly pending training remains nonzero. **Do not wait on a machine job or invent data to bypass upstream lag.** The human/operator can return when certification resumes.
4. Once certified and unpaused, settle permissionlessly. Compare recorded trainWork to the two exact cumulative-work endpoints. Confirm Stamina gain from the published formula and original-week score. A certified true-zero window produces no gain. A second settlement reverts.
5. Challenge the second NFT in the same Stamina band. Its owner accepts before the hour/week ends. Verify both transfer locks, weekly counters and snapshotted Stamina. Save the future block hash promptly (or settle directly while available). After the 15-second minimum and target block, settle and verify both distances, the winner's +2 Stamina, 10/1 wallet points and original-week score increments of `2*distance`.
6. Confirm replay prevention, the rematch cooldown, and that transferring after the race does not move wallet points. In a separate abandoned race, anyone can release locks after an unsaved hash expires; no result/points are created and accepted quota remains consumed.
7. After the week ends, settle its remaining trains and resolve its accepted races. Finalize permissionlessly, read the top ten, and claim point tiers once. Claims pay the week-specific first-activity beneficiary even after an NFT sale. A lagging Core may leave a season unfinalizable until its certified training resolves; this is intentional.

The network deployer should append confirmed addresses, deployment transaction hashes, verification links and completed owner steps to its launch receipt. This build does not claim that those actions occurred.

## Ongoing responsibilities

| Actor | Responsibility |
| --- | --- |
| Launch owner | Verify and wire the graph once, choose public mint availability, safely supply demo NFTs, handle two-step ownership handover |
| Players / volunteer keepers | Settle certified trains, save match hashes before 256-block expiry, settle or expire races, finalize and claim tiers |
| Site operator | Publish only confirmed addresses, maintain local ABI files, show unknown/paused/stale states, monitor RPC and reorgs |
| Upstream Core governance / reporter | Maintain honest certification and implementation continuity; HamsterRun has no control over their availability |
| Network reviewer / deployer | Independent review, manifest, reproducible factory deployment, explorer verification, and confirmed address handoff |

No contract needs ETH beyond transaction gas. There are no protocol fees, custodial balances, payouts, oracle subscriptions, hidden backend signers or recurring worker timers.
