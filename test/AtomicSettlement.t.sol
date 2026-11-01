// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameFixture, MatchBook, PointsLedger} from "./GameFixture.sol";

contract AtomicSettlementTest is GameFixture {
    function testRevertedScoreWriteDoesNotConsumeTrainOrIncreaseStamina() public {
        _book(1, alice, 2);
        _certify(2, 6000);
        bytes memory failure = abi.encodeWithSignature("Error(string)", "score write failed");
        vm.mockCallRevert(address(board), abi.encodeCall(board.recordTrain, (0, 1, uint64(6000))), failure);
        vm.expectRevert(failure);
        train.settle(1, 0);
        (, bool settled, uint64 work) = train.bookings(1, 0);
        assertFalse(settled);
        assertEq(work, 0);
        assertEq(nft.stamina(1), 0);
        assertEq(board.pendingTrains(0), 1);
        assertEq(board.score(0, 1), 0);
        vm.clearMockedCalls();
        train.settle(1, 0);
        assertEq(nft.stamina(1), 171);
        assertEq(board.score(0, 1), 6000);
    }

    function testRevertedPointsWritePreservesRaceAndSavedSeedForRetry() public {
        uint256 id = _startRace();
        _raceReady(id, keccak256("atomic race"));
        bytes32 seed = matches.captureRandomness(id);
        bytes memory failure = abi.encodeWithSignature("Error(string)", "points write failed");
        vm.mockCallRevert(address(ledger), abi.encodeWithSelector(PointsLedger.award.selector), failure);
        vm.expectRevert(failure);
        matches.settle(id);
        MatchBook.Race memory race = matches.races(id);
        assertEq(uint256(race.state), uint256(MatchBook.State.Running));
        assertEq(race.seed, seed);
        assertEq(race.winner, 0);
        assertEq(race.firstDistance, 0);
        assertEq(nft.stamina(1), 0);
        assertEq(nft.stamina(2), 0);
        assertTrue(nft.matchLocked(1));
        assertTrue(nft.matchLocked(2));
        assertEq(matches.activeMatch(1), id);
        assertEq(board.pendingMatches(0), 1);
        assertEq(ledger.totalPoints(), 0);
        vm.clearMockedCalls();
        vm.roll(block.number + 300);
        matches.settle(id);
        assertEq(ledger.totalPoints(), 11);
        assertFalse(nft.matchLocked(1));
        assertEq(board.pendingMatches(0), 0);
    }

    function testRevertedPrizeWriteDoesNotConsumeClaim() public {
        _book(1, alice, 2);
        _certify(2, 1000);
        train.settle(1, 0);
        vm.warp(GENESIS + 1 weeks);
        board.finalize(0);
        bytes memory failure = abi.encodeWithSignature("Error(string)", "points write failed");
        vm.mockCallRevert(address(ledger), abi.encodeWithSelector(PointsLedger.award.selector), failure);
        vm.expectRevert(failure);
        board.claimPrize(0, 1);
        assertFalse(board.prizeClaimed(0, 1));
        assertEq(ledger.points(alice), 0);
        vm.clearMockedCalls();
        board.claimPrize(0, 1);
        assertTrue(board.prizeClaimed(0, 1));
        assertEq(ledger.points(alice), 300);
    }
}
