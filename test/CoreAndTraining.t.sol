// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameFixture, CoreReader, TrainBook, GameMath, GameAdmin} from "./GameFixture.sol";

contract CoreAndTrainingTest is GameFixture {
    function testRoundBoundariesAndGenesisAlignedCalendar() public {
        (uint64 round, uint256 day, uint256 week) = reader.clock();
        assertEq(round, 1);
        assertEq(day, 0);
        assertEq(week, 0);
        vm.warp(GENESIS + 599);
        (round,,) = reader.clock();
        assertEq(round, 1);
        vm.warp(GENESIS + 600);
        (round,,) = reader.clock();
        assertEq(round, 2);
        vm.warp(GENESIS + 1 weeks);
        (round, day, week) = reader.clock();
        assertEq(round, 1009);
        assertEq(day, 7);
        assertEq(week, 1);
        vm.warp(GENESIS - 1);
        vm.expectRevert(CoreReader.BeforeGenesis.selector);
        reader.clock();
    }

    function testCertifiedDeltaAddsStaminaAndPhysicalWorkOnly() public {
        _book(1, alice, 2);
        _certify(2, 6000);
        (uint64 work, uint256 gain) = train.settle(1, 0);
        assertEq(work, 6000);
        assertEq(gain, 171);
        assertEq(nft.stamina(1), 171);
        assertEq(board.score(0, 1), 6000);
        assertEq(board.pendingTrains(0), 0);
        (uint256 recorded, uint256 distance, address beneficiary) = board.entries(0, 1);
        assertEq(recorded, 6000);
        assertEq(distance, 0);
        assertEq(beneficiary, alice);
        assertEq(ledger.points(alice), 0);
        vm.expectRevert(TrainBook.NoPendingBooking.selector);
        train.settle(1, 0);
    }

    function testFrontierOneShortIsUnknownThenRetrySucceeds() public {
        _book(1, alice, 2);
        vm.warp(GENESIS + 1 days);
        core.setFrontier(6);
        vm.expectRevert(abi.encodeWithSelector(CoreReader.UnknownRounds.selector, uint64(7), uint64(6)));
        train.settle(1, 0);
        (, bool settled,) = train.bookings(1, 0);
        assertFalse(settled);
        assertEq(board.pendingTrains(0), 1);
        assertEq(nft.stamina(1), 0);
        _certify(2, 1000);
        train.settle(1, 0);
        assertEq(nft.stamina(1), 100);
    }

    function testPauseDefersEvenCertifiedZeroAndNeverConsumesBooking() public {
        _book(1, alice, 2);
        _certify(2, 0);
        core.setPaused(true);
        vm.expectRevert(CoreReader.CorePaused.selector);
        train.settle(1, 0);
        (, bool settled,) = train.bookings(1, 0);
        assertFalse(settled);
        core.setPaused(false);
        (uint64 work, uint256 gain) = train.settle(1, 0);
        assertEq(work, 0);
        assertEq(gain, 0);
        assertEq(nft.stamina(1), 0);
        uint256[10] memory top = board.leaders(0);
        assertEq(top[0], 0);
    }

    function testUnavailableCoreIsNotZero() public {
        _book(1, alice, 2);
        core.setFailRead(true);
        vm.expectRevert("upstream unavailable");
        train.settle(1, 0);
        assertEq(board.pendingTrains(0), 1);
    }

    function testOnlyOwnerBooksAndApprovalsDoNotGrantGameAuthority() public {
        vm.prank(alice);
        nft.approve(bob, 1);
        vm.prank(bob);
        vm.expectRevert(TrainBook.NotTokenOwner.selector);
        train.book(1, 2);
        vm.prank(bob);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.applyTraining(1, 50_000);
    }

    function testNoDoubleBookingEvenAfterTransfer() public {
        _book(1, alice, 2);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(bob);
        vm.expectRevert(TrainBook.AlreadyBooked.selector);
        train.book(1, 9);
        _certify(2, 5000);
        train.settle(1, 0);
        assertEq(nft.ownerOf(1), bob);
        assertGt(nft.stamina(1), 0);
        (,, address beneficiary) = board.entries(0, 1);
        assertEq(beneficiary, alice);
    }

    function testNoBackfillNoPartialRoundNoCrossDayWindow() public {
        vm.prank(alice);
        vm.expectRevert(TrainBook.InvalidWindow.selector);
        train.book(1, 1);
        vm.prank(alice);
        vm.expectRevert(TrainBook.InvalidWindow.selector);
        train.book(1, 0);
        vm.prank(alice);
        vm.expectRevert(TrainBook.InvalidWindow.selector);
        train.book(1, 140);
        vm.prank(alice);
        vm.expectRevert(TrainBook.InvalidWindow.selector);
        train.book(1, 145);
        _book(1, alice, 139); // Last valid start, ending exactly at day end.
        vm.warp(GENESIS + 1 days);
        vm.prank(bob);
        vm.expectRevert(TrainBook.InvalidWindow.selector);
        train.book(2, 139);
        _book(2, bob, 146);
        vm.expectRevert(TrainBook.NoPendingBooking.selector);
        train.settle(2, 0);
    }

    function testCanBookNewDayWhileOldDayAwaitsCore() public {
        _book(1, alice, 2);
        vm.warp(GENESIS + 1 days);
        _book(1, alice, 146);
        assertEq(board.pendingTrains(0), 2);
        (uint64 a,,) = train.bookings(1, 0);
        (uint64 b,,) = train.bookings(1, 1);
        assertEq(a, 2);
        assertEq(b, 146);
    }

    function testReaderRejectsWrongVersionImplementationAndHash() public {
        core.setIdentity(address(core), 4);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        reader.clock();
        core.setIdentity(alice, 3);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        reader.clock();
        core.setIdentity(address(core), 3);
        CoreReader wrongHash = new CoreReader(address(core), address(core), bytes32(uint256(1)));
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        wrongHash.clock();
    }

    function testReaderRejectsWrongTimingAndImpossibleFrontier() public {
        core.setTiming(GENESIS, 601);
        vm.expectRevert(CoreReader.InvalidConfiguration.selector);
        reader.clock();
        core.setTiming(0, 600);
        vm.expectRevert(CoreReader.InvalidConfiguration.selector);
        reader.clock();
        core.setTiming(GENESIS, 600);
        core.setFrontier(10);
        vm.expectRevert(CoreReader.InvalidEndpoint.selector);
        reader.status();
        vm.expectRevert(CoreReader.InvalidEndpoint.selector);
        reader.windowWork(2);
    }

    function testReaderEndpointZeroAndWindowValidation() public {
        _certify(1, 123);
        assertEq(reader.windowWork(1), 123);
        vm.expectRevert(CoreReader.InvalidWindow.selector);
        reader.windowWork(0);
        vm.expectRevert(CoreReader.InvalidWindow.selector);
        reader.windowWork(type(uint64).max);
    }

    function testReaderRejectsPartialMalformedAndDecreasingEndpoints() public {
        _certify(2, 1000);
        for (uint256 fault = 1; fault <= 3; ++fault) {
            core.setPageFault(fault);
            vm.expectRevert(CoreReader.InvalidEndpoint.selector);
            reader.windowWork(2);
        }
        core.setPageFault(0);
        core.setPoint(1, 2000, 0);
        vm.expectRevert(CoreReader.InvalidEndpoint.selector);
        reader.windowWork(2);
        core.setPoint(1, 0, 0);
        core.setPoint(7, 60_001, 0);
        core.setFrontier(7);
        vm.expectRevert(CoreReader.InvalidEndpoint.selector);
        reader.windowWork(2);
    }

    function testStatusLagCountsClosedUnknownRounds() public {
        vm.warp(GENESIS + 10 * 600);
        core.setFrontier(4);
        (uint64 nowRound, uint64 frontier, bool paused, uint256 lag) = reader.status();
        assertEq(nowRound, 11);
        assertEq(frontier, 4);
        assertFalse(paused);
        assertEq(lag, 6);
    }

    function testFuzzExactWorkDeltaRegardlessOfBlockUnits(uint64 base, uint16 work, uint96 units) public {
        base = uint64(bound(base, 0, type(uint64).max - 60_000));
        work = uint16(bound(work, 0, 60_000));
        vm.warp(GENESIS + 7 * 600);
        core.setPoint(1, base, units);
        core.setPoint(7, base + work, units);
        core.setFrontier(7);
        assertEq(reader.windowWork(2), work);
    }

    function testFuzzTrainingDiminishesAndZeroIsZero(uint64 work, uint16 low, uint16 high) public pure {
        uint256 s1 = uint256(low) % 10_001;
        uint256 s2 = s1 + uint256(high) % (10_001 - s1);
        assertLe(GameMath.trainGain(work, s2), GameMath.trainGain(work, s1));
        assertLe(GameMath.trainGain(work, s1) + s1, 10_000);
        assertEq(GameMath.trainGain(0, s1), 0);
        assertLe(GameMath.trainGain(work, s1), 200);
    }
}
