// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISqueekCoreV3} from "../../src/interfaces/ISqueekCoreV3.sol";

/// @dev Local ABI-faithful fixture, never a launch contract or substitute for live certification.
contract MockCore is ISqueekCoreV3 {
    CoreConfiguration private _configuration;
    CoreState private _state;
    mapping(uint64 => LedgerPosition) private _positions;
    address public implementation;
    uint64 public version = 3;
    uint256 public pageFault;
    bool public failRead;

    constructor(uint64 genesis) {
        _configuration.genesisTimestamp = genesis;
        _configuration.roundDuration = 600;
        _configuration.maxWorkPerRound = 10_000;
        _configuration.maxRoundsPerBatch = 16;
        _configuration.blockUnitsPerBlock = 1e9;
        implementation = address(this);
    }

    function configuration() external view returns (CoreConfiguration memory) {
        return _configuration;
    }

    function state() external view returns (CoreState memory) {
        require(!failRead, "upstream unavailable");
        return _state;
    }

    function implementationCodeAddress() external view returns (address) {
        return implementation;
    }

    function implementationCodeVersion() external view returns (uint64) {
        return version;
    }

    function setIdentity(address implementation_, uint64 version_) external {
        implementation = implementation_;
        version = version_;
    }

    function setTiming(uint64 genesis, uint64 duration) external {
        _configuration.genesisTimestamp = genesis;
        _configuration.roundDuration = duration;
    }

    function setPaused(bool value) external {
        _state.paused = value;
    }

    function setPageFault(uint256 value) external {
        pageFault = value;
    }

    function setFailRead(bool value) external {
        failRead = value;
    }

    function setPoint(uint64 round, uint64 work, uint96 units) external {
        _positions[round] = LedgerPosition(work, units, 10875);
    }

    function setFrontier(uint64 frontier) external {
        _state.settledThroughRound = frontier;
        _state.cumulativeWork = _positions[frontier].cumulativeWork;
        _state.cumulativeBlockUnits = _positions[frontier].cumulativeBlockUnits;
    }

    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords)
        external
        view
        returns (RoundPage memory page)
    {
        require(!failRead, "upstream unavailable");
        require(afterRound == throughRound && maxRecords == 0, "not an endpoint read");
        require(throughRound <= _state.settledThroughRound, "uncertified");
        page.certifiedThroughRound = pageFault == 1 && throughRound != 0 ? throughRound - 1 : throughRound;
        page.start = _positions[throughRound];
        page.end = _positions[throughRound];
        if (pageFault == 2) ++page.end.cumulativeWork;
        page.rounds = new RoundCheckpoint[](pageFault == 3 ? 1 : 0);
    }
}
