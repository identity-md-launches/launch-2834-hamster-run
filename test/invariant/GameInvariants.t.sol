// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {MockCore} from "../mocks/MockCore.sol";
import {CoreReader} from "../../src/CoreReader.sol";
import {HamsterRunNFT} from "../../src/HamsterRunNFT.sol";
import {PointsLedger} from "../../src/PointsLedger.sol";
import {SeasonBoard} from "../../src/SeasonBoard.sol";
import {TrainBook} from "../../src/TrainBook.sol";
import {MatchBook} from "../../src/MatchBook.sol";
import {GameHandler} from "./GameHandler.sol";

/// @dev Stateful properties over random sequences of mint, transfer, book, certify, pause, settle,
/// challenge, accept, cancel, capture, race settle, expire, finalize and prize claims.
contract GameInvariantsTest is Test {
    uint64 internal constant GENESIS = 1_700_000_000;
    MockCore internal core;
    CoreReader internal reader;
    HamsterRunNFT internal nft;
    PointsLedger internal ledger;
    SeasonBoard internal board;
    TrainBook internal train;
    MatchBook internal matches;
    GameHandler internal handler;
    address internal admin = makeAddr("launch owner");

    function setUp() public {
        vm.warp(GENESIS);
        vm.roll(100);
        core = new MockCore(GENESIS);
        reader = new CoreReader(address(core), address(core), address(core).codehash);
        nft = new HamsterRunNFT(admin);
        ledger = new PointsLedger(admin);
        board = new SeasonBoard(admin, address(nft), address(ledger), address(reader));
        train = new TrainBook(address(nft), address(reader), address(board));
        matches = new MatchBook(address(nft), address(ledger), address(board), address(reader));
        vm.startPrank(admin);
        nft.configureBooks(address(train), address(matches));
        ledger.configureWriters(address(matches), address(board));
        board.configureBooks(address(train), address(matches));
        nft.setMintOpen(true);
        vm.stopPrank();

        address[4] memory actors = [makeAddr("Alice"), makeAddr("Bob"), makeAddr("Carol"), makeAddr("Dave")];
        for (uint256 i; i < actors.length; ++i) {
            vm.prank(actors[i]);
            nft.mint();
        }
        vm.prank(admin);
        nft.ownerMint(actors[0], 2);
        vm.prank(admin);
        nft.ownerMint(actors[1], 2);

        handler = new GameHandler(core, reader, nft, ledger, board, train, matches, admin, actors, GENESIS);

        bytes4[] memory selectors = new bytes4[](23);
        selectors[0] = GameHandler.warp.selector;
        selectors[1] = GameHandler.rollBlocks.selector;
        selectors[2] = GameHandler.advanceCore.selector;
        selectors[3] = GameHandler.togglePause.selector;
        selectors[4] = GameHandler.ownerMint.selector;
        selectors[5] = GameHandler.transfer.selector;
        selectors[6] = GameHandler.book.selector;
        selectors[7] = GameHandler.bookPast.selector;
        selectors[8] = GameHandler.settleTrain.selector;
        selectors[9] = GameHandler.challenge.selector;
        selectors[10] = GameHandler.accept.selector;
        selectors[11] = GameHandler.cancel.selector;
        selectors[12] = GameHandler.captureRandomness.selector;
        selectors[13] = GameHandler.settleRace.selector;
        selectors[14] = GameHandler.expire.selector;
        selectors[15] = GameHandler.finalize.selector;
        selectors[16] = GameHandler.claimPrize.selector;
        selectors[17] = GameHandler.book.selector; // booking twice as likely: it feeds most other paths
        selectors[18] = GameHandler.challengeAndAccept.selector;
        selectors[19] = GameHandler.challengeAndAccept.selector;
        selectors[20] = GameHandler.keeperTrain.selector;
        selectors[21] = GameHandler.keeperFinalize.selector;
        selectors[22] = GameHandler.keeperClaim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_pointsLedgerMatchesModelAndSums() public view {
        address[4] memory actors = handler.actors();
        uint256 sum;
        for (uint256 i; i < actors.length; ++i) {
            assertEq(ledger.points(actors[i]), handler.ghostPoints(actors[i]), "wallet points");
            sum += ledger.points(actors[i]);
        }
        assertEq(ledger.totalPoints(), sum, "totalPoints != sum of wallet points");
        assertEq(ledger.totalPoints(), handler.ghostTotalPoints());
        assertEq(ledger.points(address(handler)), 0);
        assertEq(ledger.points(admin), 0, "owner received points");
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_supplyAndStaminaBounded() public view {
        uint256 supply = nft.totalSupply();
        assertEq(supply, handler.ghostSupply());
        assertLe(supply, nft.MAX_SUPPLY());
        address[4] memory actors = handler.actors();
        uint256 balances;
        for (uint256 i; i < actors.length; ++i) {
            balances += nft.balanceOf(actors[i]);
        }
        assertEq(balances, supply, "NFT left the actor set");
        for (uint256 t = 1; t <= supply; ++t) {
            assertLe(nft.stamina(t), nft.MAX_STAMINA(), "Stamina above cap");
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_matchLocksMatchActiveRaces() public view {
        uint256 supply = nft.totalSupply();
        for (uint256 t = 1; t <= supply; ++t) {
            uint256 id = matches.activeMatch(t);
            assertEq(nft.matchLocked(t), id != 0, "lock out of sync with active match");
            if (id == 0) continue;
            MatchBook.Race memory race = matches.races(id);
            if (race.state == MatchBook.State.Offered) {
                assertEq(race.first, t, "opponent locked by an unaccepted offer");
            } else {
                assertEq(uint256(race.state), uint256(MatchBook.State.Running), "lock on a closed race");
                assertTrue(race.first == t || race.second == t);
            }
            assertEq(nft.ownerOf(t), t == race.first ? race.firstOwner : race.secondOwner, "locked NFT moved");
        }
        uint256 next = matches.nextMatchId();
        for (uint256 id = 1; id < next; ++id) {
            MatchBook.Race memory race = matches.races(id);
            if (race.state == MatchBook.State.Running) {
                assertEq(matches.activeMatch(race.first), id);
                assertEq(matches.activeMatch(race.second), id);
            } else if (race.state == MatchBook.State.Offered) {
                assertEq(matches.activeMatch(race.first), id);
            } else if (race.state == MatchBook.State.Settled) {
                assertTrue(race.winner == race.first || race.winner == race.second);
                assertTrue(race.seed != bytes32(0));
            } else {
                assertEq(race.winner, 0, "closed race has a winner");
            }
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_seasonLiabilitiesAndFinality() public view {
        uint256 maxWeek = handler.maxWeek();
        for (uint256 week; week <= maxWeek + 1; ++week) {
            assertEq(board.pendingTrains(week), handler.ghostPendingTrains(week), "pending trains");
            assertEq(board.pendingMatches(week), handler.ghostPendingMatches(week), "pending matches");
            assertEq(board.finalized(week), handler.ghostFinalized(week), "finalization reopened or skipped");
            if (board.finalized(week)) {
                assertEq(board.pendingTrains(week), 0, "finalized with pending training");
                assertEq(board.pendingMatches(week), 0, "finalized with pending races");
            }
            assertLe(handler.ghostPrizePaid(week), 300 + 2 * 150 + 7 * 50, "prize budget exceeded");
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_scoresAndTopTenAreExact() public view {
        uint256 maxWeek = handler.maxWeek();
        uint256 supply = nft.totalSupply();
        for (uint256 week; week <= maxWeek; ++week) {
            for (uint256 t = 1; t <= supply; ++t) {
                (uint256 trainWork, uint256 raceDistance,) = board.entries(week, t);
                assertEq(trainWork, handler.ghostTrainWork(week, t), "trainWork != certified work");
                assertEq(raceDistance, handler.ghostRaceDistance(week, t), "raceDistance");
                assertEq(board.score(week, t), trainWork + 2 * raceDistance, "published k");
            }
            uint256[10] memory top = board.leaders(week);
            // Expected list: every token with a positive score, ordered by score desc then ID asc.
            uint256[10] memory expected;
            bool[] memory used = new bool[](supply + 1);
            for (uint256 slot; slot < 10; ++slot) {
                uint256 best;
                uint256 bestScore;
                for (uint256 t = 1; t <= supply; ++t) {
                    if (used[t]) continue;
                    uint256 s = board.score(week, t);
                    if (s > bestScore) {
                        best = t;
                        bestScore = s;
                    }
                }
                if (best == 0) break;
                used[best] = true;
                expected[slot] = best;
            }
            for (uint256 slot; slot < 10; ++slot) {
                assertEq(top[slot], expected[slot], "top ten differs from full sort");
            }
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_coreNeverReadPastFrontier() public view {
        // Every settled booking's window ended at or before the certified frontier when it settled,
        // and no pending booking can be settled while its end round is unknown (asserted per call).
        (uint64 currentRound,,) = reader.clock();
        assertLt(handler.frontier(), currentRound, "frontier ahead of closed rounds");
    }

    /// @dev Proves the harness is not vacuous: one scripted pass reaches every guarded path the
    /// random sequences rely on, with the handler's own expectations checked on each call.
    function testHandlerReachesEveryPath() public {
        handler.book(1, 0);
        handler.book(1, 3); // second booking the same day is rejected
        handler.bookPast(2, 0);
        handler.settleTrain(0); // window still open: UnknownRounds
        handler.keeperTrain(0, 7);
        handler.book(2, 0);
        handler.warp(7201);
        handler.advanceCore(600, 3);
        handler.togglePause(0);
        handler.settleTrain(0); // certified but Core paused: CorePaused
        handler.togglePause(1);
        handler.challengeAndAccept(3, 4);
        handler.transfer(3, 0); // locked
        handler.settleRace(0, 1);
        handler.challenge(5, 6);
        handler.cancel(1, 1);
        handler.challengeAndAccept(1, 2);
        handler.rollBlocks(300);
        handler.expire(2);
        handler.book(4, 0);
        handler.keeperFinalize(0, 11);
        handler.keeperClaim(0, 0);
        handler.keeperClaim(0, 0); // already claimed: NoPrize
        assertGt(handler.trainsSettled(), 0);
        assertGt(handler.unknownRejected(), 0);
        assertGt(handler.pausedRejected(), 0);
        assertGt(handler.racesSettled(), 0);
        assertGt(handler.racesExpired(), 0);
        assertEq(handler.seasonsFinalized(), 1);
        assertEq(handler.prizesClaimed(), 1);
        invariant_pointsLedgerMatchesModelAndSums();
        invariant_matchLocksMatchActiveRaces();
        invariant_seasonLiabilitiesAndFinality();
        invariant_scoresAndTopTenAreExact();
    }

    function afterInvariant() public view {
        // Not asserted (a short random run can legitimately miss a path); logged so a vacuous
        // configuration is visible in -vv output.
        console.log(
            "trains booked/settled/zero",
            handler.trainsBooked(),
            handler.trainsSettled(),
            handler.zeroWorkSettles()
        );
        console.log("unknown/paused rejected", handler.unknownRejected(), handler.pausedRejected());
        console.log(
            "races accepted/settled/expired",
            handler.racesAccepted(),
            handler.racesSettled(),
            handler.racesExpired()
        );
        console.log("finalized/prizes", handler.seasonsFinalized(), handler.prizesClaimed());
    }
}
