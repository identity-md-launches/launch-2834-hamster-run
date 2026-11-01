// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameFixture, MatchBook, HamsterRunNFT, GameMath} from "./GameFixture.sol";

contract MatchesTest is GameFixture {
    function testRaceFullLifecycleRecordsBothDistancesAndWalletPoints() public {
        uint256 id = _startRace();
        assertTrue(nft.matchLocked(1));
        assertTrue(nft.matchLocked(2));
        assertEq(board.pendingMatches(0), 1);
        _raceReady(id, keccak256("race one"));
        vm.prank(carol);
        matches.settle(id);
        MatchBook.Race memory race = matches.races(id);
        assertEq(uint256(race.state), uint256(MatchBook.State.Settled));
        assertGe(race.firstDistance, 10_000);
        assertLt(race.firstDistance, 22_000);
        assertGe(race.secondDistance, 10_000);
        assertLt(race.secondDistance, 22_000);
        assertEq(nft.stamina(race.winner), 2);
        address winner = race.winner == 1 ? alice : bob;
        address loser = race.winner == 1 ? bob : alice;
        assertEq(ledger.points(winner), 10);
        assertEq(ledger.points(loser), 1);
        assertEq(ledger.totalPoints(), 11);
        assertEq(ledger.points(carol), 0);
        assertEq(board.score(0, 1), race.firstDistance / 100);
        assertEq(board.score(0, 2), race.secondDistance / 100);
        assertEq(board.pendingMatches(0), 0);
        assertFalse(nft.matchLocked(1));
        assertFalse(nft.matchLocked(2));
        assertEq(matches.activeMatch(1), 0);
        assertEq(matches.activeMatch(2), 0);
        vm.expectRevert(MatchBook.WrongState.selector);
        matches.settle(id);
        vm.expectRevert(MatchBook.WrongState.selector);
        matches.accept(id);
    }

    function testCannotSettleOrCaptureBeforeFutureBlockAndFifteenSeconds() public {
        uint256 id = _startRace();
        MatchBook.Race memory race = matches.races(id);
        vm.expectRevert(MatchBook.NotReady.selector);
        matches.settle(id);
        vm.expectRevert(MatchBook.NotReady.selector);
        matches.captureRandomness(id);
        vm.roll(race.randomBlock);
        vm.warp(race.readyAt);
        vm.expectRevert(MatchBook.NotReady.selector);
        matches.settle(id);
        vm.roll(race.randomBlock + 1);
        vm.setBlockhash(race.randomBlock, keccak256("future"));
        vm.warp(race.readyAt - 1);
        matches.captureRandomness(id);
        vm.expectRevert(MatchBook.NotReady.selector);
        matches.settle(id);
        vm.warp(race.readyAt);
        matches.settle(id);
    }

    function testSnapshotCannotBeRerolledAndSurvivesBlockhashExpiry() public {
        uint256 id = _startRace();
        _raceReady(id, keccak256("saved"));
        bytes32 seed = matches.captureRandomness(id);
        assertEq(matches.captureRandomness(id), seed);
        vm.roll(block.number + 300);
        vm.expectRevert(MatchBook.CannotExpire.selector);
        matches.expire(id);
        matches.settle(id);
        assertEq(matches.races(id).seed, seed);
    }

    function testExpiredRandomnessReleasesLocksWithoutPointsAndConsumesQuota() public {
        uint256 id = _startRace();
        MatchBook.Race memory race = matches.races(id);
        vm.roll(race.randomBlock + 256);
        vm.expectRevert(MatchBook.CannotExpire.selector);
        matches.expire(id);
        vm.roll(race.randomBlock + 257);
        vm.warp(race.readyAt);
        vm.expectRevert(MatchBook.RandomnessExpired.selector);
        matches.settle(id);
        vm.prank(carol);
        matches.expire(id);
        assertEq(uint256(matches.races(id).state), uint256(MatchBook.State.Expired));
        assertFalse(nft.matchLocked(1));
        assertFalse(nft.matchLocked(2));
        assertEq(board.pendingMatches(0), 0);
        assertEq(board.score(0, 1), 0);
        assertEq(matches.matchesPlayed(0, 1), 1);
        assertEq(matches.walletMatchesPlayed(0, alice), 1);
        assertEq(ledger.totalPoints(), 0);
        vm.prank(alice);
        vm.expectRevert(MatchBook.Cooldown.selector);
        matches.challenge(1, 2);
    }

    function testLastAvailableBlockhashIsAccepted() public {
        uint256 id = _startRace();
        MatchBook.Race memory race = matches.races(id);
        vm.roll(race.randomBlock + 256);
        vm.warp(race.readyAt);
        vm.setBlockhash(race.randomBlock, keccak256("last block"));
        matches.settle(id);
        assertEq(ledger.totalPoints(), 11);
    }

    function testUnsolicitedChallengeDoesNotLockOpponentAndCanBeCancelled() public {
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        assertTrue(nft.matchLocked(1));
        assertFalse(nft.matchLocked(2));
        vm.prank(bob);
        nft.transferFrom(bob, carol, 2);
        vm.prank(bob);
        vm.expectRevert(MatchBook.NotTokenOwner.selector);
        matches.accept(id);
        vm.prank(carol);
        vm.expectRevert(MatchBook.NotTokenOwner.selector);
        matches.accept(id);
        vm.prank(bob);
        vm.expectRevert(MatchBook.NotTokenOwner.selector);
        matches.cancel(id);
        vm.prank(alice);
        matches.cancel(id);
        assertFalse(nft.matchLocked(1));
        assertEq(matches.matchesPlayed(0, 1), 0);
    }

    function testOfferExpiryAndWeekBoundary() public {
        vm.warp(GENESIS + 1 weeks - 10);
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.warp(GENESIS + 1 weeks);
        vm.prank(bob);
        vm.expectRevert(MatchBook.ChallengeExpired.selector);
        matches.accept(id);
        vm.expectRevert(MatchBook.CannotExpire.selector);
        matches.expire(id);
        vm.warp(GENESIS + 1 weeks - 10 + 1 hours);
        matches.expire(id);
        assertEq(matches.activeMatch(1), 0);
        assertFalse(nft.matchLocked(1));
    }

    function testExactOfferDeadlineRejectsAcceptAllowsExpire() public {
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.warp(GENESIS + 1 hours);
        vm.prank(bob);
        vm.expectRevert(MatchBook.ChallengeExpired.selector);
        matches.accept(id);
        matches.expire(id);
    }

    function testNoSelfRaceAndNoUnownedActions() public {
        vm.prank(admin);
        nft.ownerMint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(MatchBook.InvalidOpponent.selector);
        matches.challenge(1, 1);
        vm.prank(alice);
        vm.expectRevert(MatchBook.InvalidOpponent.selector);
        matches.challenge(1, 4);
        vm.prank(bob);
        vm.expectRevert(MatchBook.NotTokenOwner.selector);
        matches.challenge(1, 2);
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.prank(carol);
        vm.expectRevert(MatchBook.NotTokenOwner.selector);
        matches.accept(id);
    }

    function testNFTCannotTransferWhileOfferedOrRunning() public {
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.InMatch.selector);
        nft.transferFrom(alice, carol, 1);
        vm.prank(bob);
        matches.accept(id);
        vm.prank(bob);
        vm.expectRevert(HamsterRunNFT.InMatch.selector);
        nft.safeTransferFrom(bob, carol, 2);
        vm.prank(alice);
        vm.expectRevert(MatchBook.WrongState.selector);
        matches.cancel(id);
        _raceReady(id, keccak256("transfer"));
        matches.settle(id);
        uint256 alicePoints = ledger.points(alice);
        vm.prank(alice);
        nft.transferFrom(alice, carol, 1);
        assertEq(ledger.points(alice), alicePoints);
        assertEq(ledger.points(carol), 0);
    }

    function testBusyTokensCannotBeAcceptedInTwoMatches() public {
        vm.prank(alice);
        uint256 first = matches.challenge(1, 2);
        vm.prank(carol);
        uint256 second = matches.challenge(3, 2);
        vm.prank(bob);
        matches.accept(first);
        vm.prank(bob);
        vm.expectRevert(MatchBook.TokenBusy.selector);
        matches.accept(second);
        vm.prank(carol);
        matches.cancel(second);
        assertTrue(nft.matchLocked(2));
        assertEq(matches.activeMatch(2), first);
    }

    function testBandRecheckedAtAcceptanceAndSnapshotFrozenAfterAcceptance() public {
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        for (uint256 i; i < 110; ++i) {
            vm.prank(address(train));
            nft.applyTraining(1, 60_000);
        }
        assertGt(nft.stamina(1), 2000);
        vm.prank(bob);
        vm.expectRevert(MatchBook.BandMismatch.selector);
        matches.accept(id);
        vm.prank(alice);
        matches.cancel(id);
        vm.prank(alice);
        vm.expectRevert(MatchBook.BandMismatch.selector);
        matches.challenge(1, 2);
    }

    function testBandBoundariesAndCappedHamsterCanRaceTopBand() public {
        assertEq(matches.band(0), 0);
        assertEq(matches.band(1999), 0);
        assertEq(matches.band(2000), 1);
        assertEq(matches.band(7999), 3);
        assertEq(matches.band(8000), 4);
        assertEq(matches.band(9999), 4);
        assertEq(matches.band(10_000), 4);
        assertEq(matches.band(type(uint256).max), 4);
        for (uint256 i; i < 1000 && nft.stamina(1) < 10_000; ++i) {
            vm.prank(address(train));
            nft.applyTraining(1, 60_000);
        }
        for (uint256 i; i < 1000 && nft.stamina(2) < 8000; ++i) {
            vm.prank(address(train));
            nft.applyTraining(2, 60_000);
        }
        assertEq(nft.stamina(1), 10_000);
        assertGe(nft.stamina(2), 8000);
        assertLt(nft.stamina(2), 10_000);
        vm.prank(carol); // Token 3 has Stamina 0: a different band.
        vm.expectRevert(MatchBook.BandMismatch.selector);
        matches.challenge(3, 1);
        vm.prank(alice);
        uint256 id = matches.challenge(1, 2);
        vm.prank(bob);
        matches.accept(id);
        assertEq(matches.races(id).firstStamina, 10_000);
    }

    function testTrainingDuringRaceDoesNotChangeItsSnapshot() public {
        uint256 id = _startRace();
        vm.prank(address(train));
        nft.applyTraining(1, 6000);
        _raceReady(id, keccak256("snapshot"));
        matches.settle(id);
        MatchBook.Race memory race = matches.races(id);
        assertEq(race.firstStamina, 0);
        uint256 expected = GameMath.raceDistance(0, uint256(keccak256(abi.encode(race.seed, uint8(0)))));
        assertEq(race.firstDistance, expected);
    }

    function testWeeklyCapsAndCooldownAcrossTransfers() public {
        for (uint256 i; i < 5; ++i) {
            vm.warp(uint256(GENESIS) + i * 1 days);
            uint256 id = _startRace();
            _raceReady(id, keccak256(abi.encode(i)));
            matches.settle(id);
        }
        vm.warp(GENESIS + 5 days);
        vm.prank(alice);
        vm.expectRevert(MatchBook.WeeklyLimit.selector);
        matches.challenge(1, 2);
        vm.prank(alice);
        nft.transferFrom(alice, carol, 1);
        vm.prank(carol);
        vm.expectRevert(MatchBook.WeeklyLimit.selector);
        matches.challenge(1, 2);
        vm.prank(carol);
        nft.transferFrom(carol, alice, 1);
        vm.warp(GENESIS + 1 weeks);
        uint256 next = _startRace();
        assertEq(matches.matchesPlayed(1, 1), 1);
        assertEq(matches.races(next).week, 1);
    }

    function testWalletCooldownCannotBeBypassedWithDifferentNFTs() public {
        uint256 id = _startRace();
        _raceReady(id, keccak256("cooldown"));
        matches.settle(id);
        vm.startPrank(admin);
        nft.ownerMint(alice, 1);
        nft.ownerMint(bob, 1);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(MatchBook.Cooldown.selector);
        matches.challenge(4, 5);
        vm.warp(GENESIS + 1 days);
        vm.prank(alice);
        matches.challenge(4, 5);
    }

    function testRaceCanFinishDuringCorePauseOrUpgrade() public {
        uint256 id = _startRace();
        core.setPaused(true);
        core.setIdentity(address(core), 4);
        _raceReady(id, keccak256("paused"));
        matches.settle(id);
        assertEq(ledger.totalPoints(), 11);
        assertFalse(nft.matchLocked(1));
    }

    function testFuzzHigherStaminaRaisesDistanceForSameNoiseWithSoftCap(uint16 low, uint16 high, uint256 seed)
        public
        pure
    {
        uint256 a = uint256(low) % 10_001;
        uint256 b = a + uint256(high) % (10_001 - a);
        uint256 da = GameMath.raceDistance(a, seed);
        uint256 db = GameMath.raceDistance(b, seed);
        assertGe(db, da);
        assertLt(db - da, 2000);
        assertLt(db, 22_000);
        assertGe(da, 10_000);
    }

    function testSoftCapProbabilityAndUnderdogCanWin() public pure {
        uint256 difference = GameMath.raceDistance(10_000, 0) - GameMath.raceDistance(0, 0);
        // Exact count of twice the wins plus ties over all 10,000^2 uniform noise pairs.
        uint256 twiceWins = 200_000_000 - (10_000 - difference) ** 2;
        assertGt(twiceWins, 130_000_000);
        assertLt(twiceWins, 140_000_000);
        assertGt(GameMath.raceDistance(0, 9999), GameMath.raceDistance(10_000, 0));
    }
}
