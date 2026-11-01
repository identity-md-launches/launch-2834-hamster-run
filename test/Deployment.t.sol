// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {HamsterRunNFT} from "../src/HamsterRunNFT.sol";
import {GameAdmin} from "../src/lib/GameAdmin.sol";
import {CoreReader} from "../src/CoreReader.sol";

contract EmptyChainFactory {
    function deploy(bytes memory code, bytes32 salt) external returns (address result) {
        assembly ("memory-safe") { result := create2(0, add(code, 32), mload(code), salt) }
        require(result != address(0), "constructor failed");
    }
}

contract DeploymentTest is Test {
    function testConstructorScriptUsesExplicitOwnerAndNoExternalCode() public {
        Deploy rehearsal = new Deploy();
        address owner = makeAddr("explicit owner");
        Deploy.Deployment memory apps =
            rehearsal.deploy(owner, rehearsal.CORE(), rehearsal.IMPLEMENTATION(), rehearsal.RUNTIME_HASH());
        assertEq(apps.nft.owner(), owner);
        assertEq(apps.ledger.owner(), owner);
        assertEq(apps.board.owner(), owner);
        assertEq(address(apps.reader.core()), rehearsal.CORE());
        assertEq(address(apps.train.nft()), address(apps.nft));
        assertEq(address(apps.matches.board()), address(apps.board));
        assertEq(address(apps.board.ledger()), address(apps.ledger));
        vm.prank(owner);
        vm.expectRevert(GameAdmin.NotConfigured.selector);
        apps.nft.setMintOpen(true);
        vm.startPrank(owner);
        apps.nft.configureBooks(address(apps.train), address(apps.matches));
        apps.ledger.configureWriters(address(apps.matches), address(apps.board));
        apps.board.configureBooks(address(apps.train), address(apps.matches));
        apps.nft.setMintOpen(true);
        vm.stopPrank();
        address[6] memory list = [
            address(apps.reader),
            address(apps.nft),
            address(apps.ledger),
            address(apps.board),
            address(apps.train),
            address(apps.matches)
        ];
        for (uint256 i; i < list.length; ++i) {
            _checkRuntime(list[i]);
        }
    }

    function testFactoryDeploymentCannotCaptureOwnership() public {
        address owner = makeAddr("requester");
        EmptyChainFactory factory = new EmptyChainFactory();
        bytes memory code = bytes.concat(type(HamsterRunNFT).creationCode, abi.encode(owner));
        HamsterRunNFT token = HamsterRunNFT(factory.deploy(code, keccak256("nft")));
        assertEq(token.owner(), owner);
        assertTrue(token.owner() != address(factory));
        vm.prank(address(factory));
        vm.expectRevert();
        token.ownerMint(owner, 1);
        vm.prank(owner);
        token.ownerMint(owner, 1);
        assertEq(token.ownerOf(1), owner);
    }

    function testInvalidConstructorArgumentsThroughFactory() public {
        EmptyChainFactory factory = new EmptyChainFactory();
        vm.expectRevert("constructor failed");
        factory.deploy(
            bytes.concat(type(HamsterRunNFT).creationCode, abi.encode(address(0))), bytes32(uint256(1))
        );
        vm.expectRevert("constructor failed");
        factory.deploy(
            bytes.concat(
                type(CoreReader).creationCode, abi.encode(address(0), address(1), bytes32(uint256(1)))
            ),
            bytes32(uint256(2))
        );
        vm.expectRevert("constructor failed");
        factory.deploy(
            bytes.concat(
                type(CoreReader).creationCode, abi.encode(address(1), address(0), bytes32(uint256(1)))
            ),
            bytes32(uint256(3))
        );
        vm.expectRevert("constructor failed");
        factory.deploy(
            bytes.concat(type(CoreReader).creationCode, abi.encode(address(1), address(2), bytes32(0))),
            bytes32(uint256(4))
        );
    }

    function _checkRuntime(address application) internal view {
        bytes memory code = application.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        bool reachable = true;
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op == 0x5b) reachable = true;
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            if (reachable) assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
            if (op == 0x00 || op == 0x56 || op == 0xf3 || op == 0xfd || op == 0xfe || op == 0xff) {
                reachable = false;
            }
        }
    }
}
