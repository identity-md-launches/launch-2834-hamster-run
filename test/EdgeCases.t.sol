// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {stdStorage, StdStorage} from "forge-std/Test.sol";
import {
    GameFixture,
    CoreReader,
    MatchBook,
    SeasonBoard,
    PointsLedger,
    GameAdmin,
    GameMath
} from "./GameFixture.sol";

contract EdgeCasesTest is GameFixture {
    using stdStorage for StdStorage;

    function _setStamina(uint256 tokenId, uint256 value) internal {
        stdstore.target(address(nft)).sig("stamina(uint256)").with_key(tokenId).checked_write(value);
    }

    /// An upstream upgrade defers training (never zero) and holds the season open until Core is
    /// trusted again; nothing is consumed while it is unavailable.
    function testCoreUpgradeDefersTrainingAndHoldsSeasonOpen() public {
        _book(1, alice, 2);
        _certify(2, 2500);
        core.setIdentity(address(core), 4);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        train.settle(1, 0);
        vm.warp(GENESIS + 1 weeks);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        board.finalize(0);
        (, bool settled,) = train.bookings(1, 0);
        assertFalse(settled);
        assertEq(nft.stamina(1), 0);
        assertEq(board.pendingTrains(0), 1);
        vm.prank(bob);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        train.book(2, 1010);

        core.setIdentity(address(core), 3);
        (uint64 work,) = train.settle(1, 0);
        assertEq(work, 2500);
        board.finalize(0);
        assertTrue(board.finalized(0));
    }

    function testFinalizeExactlyAtWeekEndAndNeverTwice() public {
        vm.warp(GENESIS + 1 weeks - 1);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(1);
        vm.warp(GENESIS + 1 weeks);
        board.finalize(0);
        vm.expectRevert(SeasonBoard.SeasonClosed.selector);
        board.finalize(0);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(1);
        // A closed week accepts no new activity: the clock has moved on to week 1.
        vm.prank(address(train));
        vm.expectRevert(SeasonBoard.WrongWeek.selector);
        board.registerTrain(0, 1, alice);
    }

    function testUnfinalizedOrEmptyWeekHasNoPrize() public {
        _book(1, alice, 2);
        _certify(2, 900);
        train.settle(1, 0);
        assertEq(board.leaders(0)[0], 1);
        assertEq(board.prize(0, 1), 0, "prize before finalization");
        vm.expectRevert(SeasonBoard.NoPrize.selector);
        board.claimPrize(0, 1);
        vm.warp(GENESIS + 1 weeks);
        board.finalize(0);
        assertEq(board.prize(0, 0), 0, "empty slot ID earns a prize");
        assertEq(board.prize(0, 2), 0, "unlisted NFT earns a prize");
        vm.expectRevert(SeasonBoard.NoPrize.selector);
        board.claimPrize(0, 0);
        board.claimPrize(0, 1);
        vm.expectRevert(SeasonBoard.NoPrize.selector);
        board.claimPrize(0, 1);
        assertEq(ledger.points(alice), 300);
    }

    function testTrueZeroWorkSettlesWithoutGainOrScore() public {
        _book(1, alice, 2);
        _certify(2, 0);
        (uint64 work, uint256 gain) = train.settle(1, 0);
        assertEq(work, 0);
        assertEq(gain, 0);
        assertEq(nft.stamina(1), 0);
        assertEq(board.score(0, 1), 0);
        assertEq(board.leaders(0)[0], 0, "zero score entered the board");
        assertEq(board.pendingTrains(0), 0);
    }

    function testBandBoundaryIsExact() public {
        _setStamina(1, 1999);
        _setStamina(2, 2000);
        vm.prank(alice);
        vm.expectRevert(MatchBook.BandMismatch.selector);
        matches.challenge(1, 2);
        _setStamina(2, 0);
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        // Opponent trains across the band before accepting: rechecked at acceptance.
        _setStamina(2, 2000);
        vm.prank(bob);
        vm.expectRevert(MatchBook.BandMismatch.selector);
        matches.accept(id);
    }

    function testWinnerBumpSaturatesAtMaxStamina() public {
        _setStamina(1, 9_999);
        _setStamina(2, 9_999);
        uint256 id = _startRace();
        _raceReady(id, keccak256("cap"));
        matches.settle(id);
        uint256 winner = matches.races(id).winner;
        assertEq(nft.stamina(winner), 10_000);
        assertEq(nft.stamina(winner == 1 ? 2 : 1), 9_999);
        // At the cap, certified work adds nothing more.
        _setStamina(1, 10_000);
        _book(1, alice, 2);
        _certify(2, 60_000);
        (, uint256 gain) = train.settle(1, 0);
        assertEq(gain, 0);
        assertEq(nft.stamina(1), 10_000);
    }

    function testLedgerRejectsZeroAccountAndOutsiders() public {
        vm.prank(address(matches));
        vm.expectRevert(GameAdmin.InvalidAddress.selector);
        ledger.award(address(0), 1, bytes32(0));
        vm.prank(admin);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        ledger.award(admin, 1, bytes32(0));
        vm.prank(address(train));
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        ledger.award(alice, 1, bytes32(0));
        assertEq(ledger.totalPoints(), 0);
    }

    function testGameWritersRejectDirectCalls() public {
        vm.startPrank(alice);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.applyTraining(1, 60_000);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.rewardWinner(1);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.setMatchLock(2, true);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.recordTrain(0, 1, 60_000);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.recordMatch(0, 1, 2, 20_000, 0);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.expireMatch(0);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.registerMatch(0, 1, 2, alice, bob);
        vm.stopPrank();
        assertEq(nft.stamina(1), 0);
        assertFalse(nft.matchLocked(2));
    }

    function testExpiredOfferCannotBeAcceptedButReleasesChallenger() public {
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.expectRevert(MatchBook.CannotExpire.selector);
        matches.expire(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        vm.expectRevert(MatchBook.ChallengeExpired.selector);
        matches.accept(id);
        vm.prank(carol);
        matches.expire(id);
        assertFalse(nft.matchLocked(1));
        assertEq(matches.activeMatch(1), 0);
        assertEq(board.pendingMatches(0), 0, "unaccepted offer created a board liability");
        vm.prank(alice);
        vm.expectRevert(MatchBook.WrongState.selector);
        matches.cancel(id);
        vm.expectRevert(MatchBook.WrongState.selector);
        matches.expire(id);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzTrainGainBoundedByCapAndPerWindowMaximum(uint64 work, uint256 stamina) public pure {
        stamina = bound(stamina, 0, 10_000);
        uint256 gain = GameMath.trainGain(work, stamina);
        assertLe(stamina + gain, 10_000);
        assertLt(gain, 200);
        if (work == 0) assertEq(gain, 0);
        if (work < type(uint64).max) {
            assertGe(GameMath.trainGain(work + 1, stamina), gain, "more work, less gain");
        }
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzRaceDistanceRangeAndClamp(uint256 stamina, uint256 word) public pure {
        uint256 d = GameMath.raceDistance(stamina, word);
        assertGe(d, 10_000);
        assertLt(d, 10_000 + 2_000 + 10_000);
        if (stamina > 10_000) assertEq(d, GameMath.raceDistance(10_000, word));
    }
}
