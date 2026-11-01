// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockCore} from "./mocks/MockCore.sol";
import {CoreReader} from "../src/CoreReader.sol";
import {HamsterRunNFT} from "../src/HamsterRunNFT.sol";
import {PointsLedger} from "../src/PointsLedger.sol";
import {SeasonBoard} from "../src/SeasonBoard.sol";
import {TrainBook} from "../src/TrainBook.sol";
import {MatchBook} from "../src/MatchBook.sol";
import {GameAdmin} from "../src/lib/GameAdmin.sol";
import {GameMath} from "../src/lib/GameMath.sol";

abstract contract GameFixture is Test {
    uint64 internal constant GENESIS = 1_700_000_000;
    address internal admin = makeAddr("launch owner");
    address internal alice = makeAddr("Alice");
    address internal bob = makeAddr("Bob");
    address internal carol = makeAddr("Carol");
    MockCore internal core;
    CoreReader internal reader;
    HamsterRunNFT internal nft;
    PointsLedger internal ledger;
    SeasonBoard internal board;
    TrainBook internal train;
    MatchBook internal matches;

    function setUp() public virtual {
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
        vm.prank(alice);
        nft.mint();
        vm.prank(bob);
        nft.mint();
        vm.prank(carol);
        nft.mint();
    }

    function _book(uint256 tokenId, address owner_, uint64 start) internal {
        vm.prank(owner_);
        train.book(tokenId, start);
    }

    function _certify(uint64 start, uint64 work) internal {
        core.setPoint(start - 1, 100, 900_000);
        core.setPoint(start + 5, 100 + work, 900_000);
        core.setFrontier(start + 5);
        uint256 closedAt = uint256(GENESIS) + uint256(start + 5) * 600;
        if (block.timestamp < closedAt) vm.warp(closedAt);
    }

    function _startRace() internal returns (uint256 id) {
        vm.prank(alice);
        id = matches.challenge(1, 2);
        vm.prank(bob);
        matches.accept(id);
    }

    function _raceReady(uint256 id, bytes32 hash) internal {
        MatchBook.Race memory race = matches.races(id);
        vm.roll(race.randomBlock + 1);
        vm.setBlockhash(race.randomBlock, hash);
        vm.warp(race.readyAt);
    }
}
