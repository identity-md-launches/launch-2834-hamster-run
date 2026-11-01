# Local validation record

This records the builder's checks, not an independent audit or a deployment attestation.

| Check | Result |
| --- | --- |
| `forge build` with Solidity 0.8.26 and the delivered root configuration | Pass |
| `forge test` | **54 passed, 0 failed, 0 skipped**, across five suites |
| Deterministic fuzzing | Four fuzz properties, 512 cases each, using `0x39b28f5234281505aa1affaf6e899719917a539eef55a3027471750095572375` |
| `forge fmt --check` | Pass |
| Local deployment rehearsal | Six applications deploy; explicit owner and dependency references checked |
| EIP-170 / protected opcode scan | All six runtimes pass; no reachable DELEGATECALL, CALLCODE or SELFDESTRUCT |
| V3 ABI comparison | All five consumed functions match the published ABI's input/output fields and nested tuple layouts |
| Real Sepolia fork check, block 12042124 | Pinned identity, clock/frontier, positive certified work, certified zero work, and one-round-beyond-frontier rejection pass |
| Read-only live preflight | Recorded in `docs/upstream/core-snapshot.json`; no transaction sent |
| Browser exercise on a local six-contract Anvil fixture | Mint, book, unknown-frontier rejection, certified training, account switching, challenge/accept, future-block race settlement, points, board, finalize and beneficiary-bound prize claim pass |
| Desktop/mobile browser check | Explicit pending-deployment state, disabled transactions without addresses, no horizontal overflow at 390 px, no JavaScript exceptions during the local game flow |
| Browser JS / owner-action tool syntax and Python tool compilation | Pass |
| Unsigned owner configuration generator | Four calls use the named owner, Sepolia chain, confirmed input addresses and zero ETH value; no broadcast capability |

The browser fixture and fork scaffolding used `test/scratch/`, as permitted by the assignment. They are not submitted as application dependencies. The maintained offline Solidity suite is under `test/`; its default run does not require RPC access, keys or environment variables. Browser tests used local accounts and a local Core fixture; they do not claim Sepolia game deployment or live reporter control.

The five test suites cover certified/unknown/paused work, exact boundaries, double booking and transfer behavior, diminishing gains, ERC-721 mint limits and callback reentrancy, writer permissions and two-step ownership, challenge deadlines, immutable race snapshots, hash capture/expiry, quotas/cooldowns, bounded race advantage, top-ten ranking against a full sort, week finalization, prize replay, and atomic rollback when downstream score/points writes fail.

Final application runtime sizes (bytes):

| Application | Runtime |
| --- | ---: |
| CoreReader | 4,759 |
| HamsterRunNFT | 7,366 |
| PointsLedger | 1,481 |
| SeasonBoard | 5,422 |
| TrainBook | 2,360 |
| MatchBook | 8,147 |

Slither, Mythril and an independent adversarial audit were not run by this worker. Foundry's generic lint notices about timestamp scheduling, known dependency calls and event ordering are not treated as proof of a vulnerability or of safety. The concrete controls and remaining assumptions are in `THREATS.md`.

Live limitations remain explicit: HamsterRun deployment addresses await the network launch, and at the recorded upstream block 863 closed rounds were still unknown. A new training window must wait for actual certification. No check replaces those rounds with zero or substitutes a different Core address.
