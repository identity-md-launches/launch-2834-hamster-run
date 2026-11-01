// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

abstract contract GameAdmin is Ownable2Step {
    error InvalidAddress();
    error AlreadyConfigured();
    error NotConfigured();
    error Unauthorized();
    error RenunciationDisabled();

    constructor(address owner_) Ownable(owner_) {}

    function renounceOwnership() public pure override {
        revert RenunciationDisabled();
    }

    function _requireContract(address target) internal view {
        if (target == address(0) || target.code.length == 0) revert InvalidAddress();
    }
}
