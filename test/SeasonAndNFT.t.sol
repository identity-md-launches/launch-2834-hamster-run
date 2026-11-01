// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    GameFixture,
    SeasonBoard,
    HamsterRunNFT,
    GameAdmin,
    PointsLedger,
    CoreReader,
    GameMath
} from "./GameFixture.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract MintReentrantReceiver is IERC721Receiver {
    HamsterRunNFT public nft;
    bool public reentrySucceeded;
    bool public attempted;

    constructor(HamsterRunNFT nft_) {
        nft = nft_;
    }

    function mint() external {
        nft.mint();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        attempted = true;
        (reentrySucceeded,) = address(nft).call(abi.encodeCall(nft.mint, ()));
        return this.onERC721Received.selector;
    }
}

contract SeasonAndNFTTest is GameFixture {
    function testCollectionMetadataAndERC721() public view {
        assertEq(nft.name(), "Hamster run");
        assertEq(nft.symbol(), "HAM");
        assertEq(nft.MAX_SUPPLY(), 10_000);
        assertEq(nft.balanceOf(alice), 1);
        assertTrue(nft.supportsInterface(0x80ac58cd));
        assertTrue(nft.supportsInterface(0x5b5e139f));
        string memory json =
            '{"name":"Hamster run #1","description":"HamsterRun: independent Sepolia game demo. No SQK rewards or official mining rights.","attributes":[{"trait_type":"Stamina","value":0}]}';
        assertEq(nft.tokenURI(1), string.concat("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function testPublicMintOncePerWalletPersistsAfterTransferAndMintPause() public {
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.MintLimit.selector);
        nft.mint();
        vm.prank(admin);
        nft.setMintOpen(false);
        vm.prank(makeAddr("new player"));
        vm.expectRevert(HamsterRunNFT.MintClosed.selector);
        nft.mint();
        vm.prank(bob); // Mint pause does not freeze transfers.
        nft.transferFrom(bob, alice, 1);
    }

    function testSupplyCapAndNoBurn() public {
        vm.startPrank(admin);
        for (uint256 i; i < 199; ++i) {
            nft.ownerMint(alice, 50);
        }
        nft.ownerMint(alice, 47);
        assertEq(nft.totalSupply(), 10_000);
        vm.expectRevert(HamsterRunNFT.MintLimit.selector);
        nft.ownerMint(alice, 1);
        vm.stopPrank();
        vm.prank(makeAddr("late minter"));
        vm.expectRevert(HamsterRunNFT.MintLimit.selector);
        nft.mint();
        vm.prank(alice);
        vm.expectRevert();
        nft.transferFrom(alice, address(0), 1);
        assertEq(nft.totalSupply(), 10_000);
    }

    function testMintCallbackReentrancyAndRejectingReceiverRollBack() public {
        MintReentrantReceiver receiver = new MintReentrantReceiver(nft);
        receiver.mint();
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentrySucceeded());
        assertEq(nft.totalSupply(), 4);
        assertEq(nft.balanceOf(address(receiver)), 1);
        vm.prank(admin);
        vm.expectRevert();
        nft.ownerMint(address(core), 2);
        assertEq(nft.totalSupply(), 4);
        vm.prank(admin);
        vm.expectRevert();
        nft.ownerMint(address(0), 1);
        assertEq(nft.totalSupply(), 4);
    }

    function testInvalidMintQuantityAndOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.ownerMint(alice, 1);
        vm.prank(admin);
        vm.expectRevert(HamsterRunNFT.InvalidQuantity.selector);
        nft.ownerMint(alice, 0);
        vm.prank(admin);
        vm.expectRevert(HamsterRunNFT.InvalidQuantity.selector);
        nft.ownerMint(alice, 51);
        vm.prank(alice);
        vm.expectRevert();
        nft.setMintOpen(false);
        vm.prank(alice);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.rewardWinner(1);
        vm.prank(alice);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        nft.setMatchLock(1, true);
    }

    function testTwoStepOwnershipAndOneTimeConfiguration() public {
        assertEq(nft.owner(), admin);
        assertEq(ledger.owner(), admin);
        assertEq(board.owner(), admin);
        vm.startPrank(admin);
        vm.expectRevert(GameAdmin.AlreadyConfigured.selector);
        nft.configureBooks(address(train), address(matches));
        vm.expectRevert(GameAdmin.AlreadyConfigured.selector);
        board.configureBooks(address(train), address(matches));
        vm.expectRevert(GameAdmin.AlreadyConfigured.selector);
        ledger.configureWriters(address(matches), address(board));
        nft.transferOwnership(carol);
        vm.stopPrank();
        assertEq(nft.owner(), admin);
        vm.prank(bob);
        vm.expectRevert();
        nft.acceptOwnership();
        vm.prank(carol);
        nft.acceptOwnership();
        assertEq(nft.owner(), carol);
        vm.prank(carol);
        vm.expectRevert(GameAdmin.RenunciationDisabled.selector);
        nft.renounceOwnership();
    }

    function testBeforeConfiguration() public {
        HamsterRunNFT fresh = new HamsterRunNFT(admin);
        vm.prank(admin);
        vm.expectRevert(GameAdmin.NotConfigured.selector);
        fresh.setMintOpen(true);
        vm.prank(alice);
        vm.expectRevert();
        fresh.configureBooks(address(train), address(matches));
        vm.prank(admin);
        vm.expectRevert(GameAdmin.InvalidAddress.selector);
        fresh.configureBooks(alice, address(matches));
        vm.prank(admin);
        vm.expectRevert(GameAdmin.InvalidAddress.selector);
        fresh.configureBooks(address(train), address(train));
        vm.prank(admin);
        fresh.configureBooks(address(train), address(matches));
    }

    function testPointsCannotTransferOrBeMintedByOwner() public {
        vm.prank(admin);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        ledger.award(alice, 100, bytes32(0));
        vm.prank(alice);
        (bool success,) = address(ledger).call(abi.encodeWithSignature("transfer(address,uint256)", bob, 10));
        assertFalse(success);
        vm.prank(address(matches));
        vm.expectRevert(GameAdmin.InvalidAddress.selector);
        ledger.award(address(0), 1, bytes32(0));
    }

    function testSeasonWaitsForUnknownTrainingThenCountsLateSettlement() public {
        _book(1, alice, 2);
        vm.warp(GENESIS + 2 weeks);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        _certify(2, 1000);
        train.settle(1, 0);
        board.finalize(0);
        assertTrue(board.finalized(0));
        assertEq(board.score(0, 1), 1000);
        assertEq(board.score(2, 1), 0);
        assertEq(board.prize(0, 1), 300);
        vm.prank(carol);
        board.claimPrize(0, 1);
        assertEq(ledger.points(alice), 300);
        vm.expectRevert(SeasonBoard.NoPrize.selector);
        board.claimPrize(0, 1);
        vm.expectRevert(SeasonBoard.SeasonClosed.selector);
        board.finalize(0);
    }

    function testFinalizationTimeAndPendingRaceThenExpiry() public {
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        uint256 id = _startRace();
        vm.warp(GENESIS + 1 weeks);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        vm.roll(matches.races(id).randomBlock + 257);
        matches.expire(id);
        board.finalize(0);
        assertEq(board.prize(0, 1), 0);
        vm.expectRevert(SeasonBoard.NoPrize.selector);
        board.claimPrize(0, 1);
    }

    function testPrizesRemainWithWeekBeneficiaryAfterNFTSale() public {
        _book(1, alice, 2);
        _certify(2, 1000);
        train.settle(1, 0);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.warp(GENESIS + 1 weeks);
        board.finalize(0);
        vm.prank(bob);
        board.claimPrize(0, 1);
        assertEq(ledger.points(alice), 300);
        assertEq(ledger.points(bob), 0);
    }

    function testPublishedWeightAndTopTenOrderingTieBreakAndPrizeTiers() public {
        vm.prank(admin);
        nft.ownerMint(alice, 12);
        for (uint256 id = 4; id <= 15; ++id) {
            vm.prank(address(train));
            board.registerTrain(0, id, alice);
            vm.prank(address(train));
            board.recordTrain(0, id, uint64(id * 100));
        }
        uint256[10] memory top = board.leaders(0);
        for (uint256 i; i < 10; ++i) {
            assertEq(top[i], 15 - i);
        }
        vm.prank(address(train));
        board.registerTrain(0, 4, alice);
        vm.prank(address(train)); // Tie: #4 beats #15.
        board.recordTrain(0, 4, 1100);
        top = board.leaders(0);
        assertEq(top[0], 4);
        assertEq(top[1], 15);
        vm.prank(address(matches));
        board.registerMatch(0, 1, 2, alice, bob);
        vm.prank(address(matches)); // One hundred race units are one score point, rounded down.
        board.recordMatch(0, 1, 2, 200_099, 400_050);
        assertEq(board.score(0, 1), 2000);
        assertEq(board.score(0, 2), 4000);
        top = board.leaders(0);
        assertEq(top[0], 2);
        assertEq(top[1], 1);
        assertEq(top[2], 4);
        vm.warp(GENESIS + 1 weeks);
        board.finalize(0);
        assertEq(board.prize(0, 2), 300);
        assertEq(board.prize(0, 1), 150);
        assertEq(board.prize(0, 4), 150);
        assertEq(board.prize(0, 15), 50);
        assertEq(board.prize(0, 3), 0);
        assertEq(board.prize(0, 0), 0);
    }

    function testCompletedWeekFinalizesAndPaysAfterCoreUpgrade() public {
        _book(1, alice, 2);
        _certify(2, 1000);
        train.settle(1, 0);
        assertEq(board.pendingTrains(0), 0);
        vm.warp(GENESIS + 1 weeks);
        core.setIdentity(address(0xBEEF), 4);
        vm.expectRevert(CoreReader.CoreIdentityChanged.selector);
        reader.configuration();
        board.finalize(0);
        assertTrue(board.finalized(0));
        assertEq(board.prize(0, 1), 300);
        board.claimPrize(0, 1);
        assertEq(ledger.points(alice), 300);
    }

    function testGraceFinalizeExcludesUncertifiedBookingWhichStillTrainsLater() public {
        _book(1, alice, 2);
        vm.prank(bob);
        uint256 id = matches.challenge(2, 3);
        vm.prank(carol);
        matches.accept(id);
        _raceReady(id, keccak256("grace"));
        matches.settle(id);
        uint256 end = reader.weekEnd(0);
        assertEq(end, GENESIS + 1 weeks);
        vm.warp(end + board.FINALIZE_GRACE() - 1);
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        vm.warp(end + board.FINALIZE_GRACE());
        vm.expectEmit(true, false, false, true);
        emit SeasonBoard.SeasonFinalized(0, 1);
        board.finalize(0);
        uint256[10] memory top = board.leaders(0);
        assertTrue(top[0] == 2 || top[0] == 3);
        assertEq(board.prize(0, top[0]), 300);
        board.claimPrize(0, top[0]);
        assertEq(ledger.points(top[0] == 2 ? bob : carol), 300 + 10);
        assertEq(board.pendingTrains(0), 1);
        // The booking is still unknown, never zero; it certifies later and trains the NFT.
        vm.expectRevert(abi.encodeWithSelector(CoreReader.UnknownRounds.selector, uint64(7), uint64(0)));
        train.settle(1, 0);
        _certify(2, 1000);
        vm.expectEmit(true, true, false, true);
        emit SeasonBoard.LateTrainExcluded(0, 1, 1000);
        (uint64 work, uint256 gain) = train.settle(1, 0);
        assertEq(work, 1000);
        assertEq(gain, 100);
        assertEq(nft.stamina(1), 100);
        assertEq(board.pendingTrains(0), 0);
        assertEq(board.score(0, 1), 0);
        assertEq(board.leaders(0)[0], top[0]);
        assertEq(board.prize(0, 1), 0);
    }

    function testGraceNeverWaivesAcceptedRaces() public {
        uint256 id = _startRace();
        vm.warp(reader.weekEnd(0) + board.FINALIZE_GRACE());
        vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
        board.finalize(0);
        vm.roll(matches.races(id).randomBlock + 257);
        matches.expire(id);
        board.finalize(0);
    }

    function testCertifiedTrainingWeekOutranksRacesUnderPublishedConversion() public {
        address dave = makeAddr("Dave");
        vm.prank(admin);
        nft.ownerMint(dave, 1); // token 4
        vm.prank(bob);
        uint256 first = matches.challenge(2, 3);
        vm.prank(carol);
        matches.accept(first);
        _raceReady(first, keccak256("race one"));
        matches.settle(first);
        vm.prank(bob);
        uint256 second = matches.challenge(2, 4);
        vm.prank(dave);
        matches.accept(second);
        _raceReady(second, keccak256("race two"));
        matches.settle(second);
        uint256 racerScore = board.score(0, 2);
        assertGt(racerScore, 0);
        assertLe(racerScore, uint256(2 * 21_959) / 100);
        // Seven windows at the largest six-round delta certified on the live Core (3,226).
        uint64 cumulative;
        for (uint64 day; day < 7; ++day) {
            vm.warp(uint256(GENESIS) + day * 1 days);
            uint64 start = day * 144 + 2;
            _book(1, alice, start);
            core.setPoint(start - 1, cumulative, 0);
            cumulative += 3226;
            core.setPoint(start + 5, cumulative, 0);
            core.setFrontier(start + 5);
            vm.warp(uint256(GENESIS) + uint256(start + 5) * 600);
            train.settle(1, day);
        }
        assertEq(board.score(0, 1), 7 * 3226);
        assertEq(board.leaders(0)[0], 1);
        // Five maximal races stay below a week of windows at the live average (about 453 per window).
        assertLt(5 * GameMath.raceDistance(10_000, 9999) / board.RACE_UNITS_PER_POINT(), 7 * 453);
        // One race is worth between 100 and 219 points.
        assertEq(GameMath.raceDistance(0, 0) / board.RACE_UNITS_PER_POINT(), 100);
        assertEq(GameMath.raceDistance(10_000, 9999) / board.RACE_UNITS_PER_POINT(), 219);
    }

    function testBoardRejectsUnauthorizedRecordsAndWrongWeek() public {
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.registerTrain(0, 1, alice);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.recordTrain(0, 1, 1000);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.registerMatch(0, 1, 2, alice, bob);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.recordMatch(0, 1, 2, 1000, 1000);
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.expireMatch(0);
        vm.prank(address(train));
        vm.expectRevert(SeasonBoard.WrongWeek.selector);
        board.registerTrain(1, 1, alice);
        vm.prank(address(train));
        vm.expectRevert(GameAdmin.Unauthorized.selector);
        board.registerTrain(0, 1, bob);
    }

    function testFuzzTopTenMatchesFullSort(uint256 seed) public {
        vm.prank(admin);
        nft.ownerMint(alice, 12);
        uint256[12] memory ids;
        for (uint256 i; i < 12; ++i) {
            uint256 id = i + 4;
            ids[i] = id;
            uint64 value = uint64(uint256(keccak256(abi.encode(seed, i))) % 60_000 + 1);
            vm.prank(address(train));
            board.registerTrain(0, id, alice);
            vm.prank(address(train));
            board.recordTrain(0, id, value);
        }
        for (uint256 i; i < 12; ++i) {
            for (uint256 j = i + 1; j < 12; ++j) {
                if (
                    board.score(0, ids[j]) > board.score(0, ids[i])
                        || (board.score(0, ids[j]) == board.score(0, ids[i]) && ids[j] < ids[i])
                ) {
                    (ids[i], ids[j]) = (ids[j], ids[i]);
                }
            }
        }
        uint256[10] memory actual = board.leaders(0);
        for (uint256 i; i < 10; ++i) {
            assertEq(actual[i], ids[i]);
        }
    }
}
