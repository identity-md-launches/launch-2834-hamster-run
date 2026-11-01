// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CoreReader} from "../src/CoreReader.sol";
import {HamsterRunNFT} from "../src/HamsterRunNFT.sol";
import {PointsLedger} from "../src/PointsLedger.sol";
import {SeasonBoard} from "../src/SeasonBoard.sol";
import {TrainBook} from "../src/TrainBook.sol";
import {MatchBook} from "../src/MatchBook.sol";

/// @notice Local deployment rehearsal only. The network deployer launches each application separately.
/// This script does not read keys, environment variables or broadcast transactions.
contract Deploy is Script {
    address public constant LAUNCH_OWNER = 0xBFB53C8E9518bA748e94Ae075E2bE561d9BAC472;
    address public constant CORE = 0x74665dAecA35A2303e767E76a2FF1FB6F93e119f;
    address public constant IMPLEMENTATION = 0x0a71C86ab63a77675002A389FDF4D096A07b11e2;
    bytes32 public constant RUNTIME_HASH = 0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d;

    struct Deployment {
        CoreReader reader;
        HamsterRunNFT nft;
        PointsLedger ledger;
        SeasonBoard board;
        TrainBook train;
        MatchBook matches;
    }

    function run() external returns (Deployment memory) {
        console2.log("LOCAL REHEARSAL ONLY. These are not confirmed Sepolia deployment addresses.");
        return deploy(LAUNCH_OWNER, CORE, IMPLEMENTATION, RUNTIME_HASH);
    }

    function deploy(address owner_, address core_, address implementation_, bytes32 runtimeHash_)
        public
        returns (Deployment memory deployed)
    {
        deployed.reader = new CoreReader(core_, implementation_, runtimeHash_);
        deployed.nft = new HamsterRunNFT(owner_);
        deployed.ledger = new PointsLedger(owner_);
        deployed.board = new SeasonBoard(
            owner_, address(deployed.nft), address(deployed.ledger), address(deployed.reader)
        );
        deployed.train =
            new TrainBook(address(deployed.nft), address(deployed.reader), address(deployed.board));
        deployed.matches = new MatchBook(
            address(deployed.nft), address(deployed.ledger), address(deployed.board), address(deployed.reader)
        );
    }
}
