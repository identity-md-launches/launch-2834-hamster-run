// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISqueekCoreV3} from "./interfaces/ISqueekCoreV3.sol";

/// @notice Immutable adapter. Work reads fail closed on an upstream identity change and require a reviewed
/// new deployment. The calendar (round, day, week, week end) is a pure function of the stream's genesis,
/// which never changes, so it is pinned on the first successful identity-checked read and no longer
/// depends on the live implementation afterwards: an upstream upgrade cannot strand finished weeks.
contract CoreReader {
    uint256 public constant ROUND_SECONDS = 600;
    uint256 public constant ROUNDS_PER_DAY = 144;
    uint256 public constant ROUNDS_PER_WEEK = 1008;
    ISqueekCoreV3 public immutable core;
    address public immutable expectedImplementation;
    bytes32 public immutable expectedRuntimeHash;
    /// @notice Zero until pinned by the first identity-checked read; write-once afterwards.
    uint64 public genesisTimestamp;

    error InvalidConfiguration();
    error CoreIdentityChanged();
    error BeforeGenesis();
    error CorePaused();
    error UnknownRounds(uint64 requested, uint64 frontier);
    error InvalidWindow();
    error InvalidEndpoint();

    event GenesisPinned(uint64 genesisTimestamp);

    constructor(address core_, address implementation_, bytes32 runtimeHash_) {
        if (core_ == address(0) || implementation_ == address(0) || runtimeHash_ == bytes32(0)) {
            revert InvalidConfiguration();
        }
        core = ISqueekCoreV3(core_);
        expectedImplementation = implementation_;
        expectedRuntimeHash = runtimeHash_;
    }

    /// @notice Identity-checked live configuration. Reverts on any upstream identity or timing change.
    function configuration() public view returns (ISqueekCoreV3.CoreConfiguration memory config) {
        if (
            core.implementationCodeVersion() != 3
                || core.implementationCodeAddress() != expectedImplementation
                || expectedImplementation.codehash != expectedRuntimeHash
        ) revert CoreIdentityChanged();
        config = core.configuration();
        uint64 pinned = genesisTimestamp;
        if (
            config.genesisTimestamp == 0 || config.roundDuration != ROUND_SECONDS
                || config.maxWorkPerRound == 0 || (pinned != 0 && config.genesisTimestamp != pinned)
        ) {
            revert InvalidConfiguration();
        }
    }

    /// @notice Pinned genesis when available, otherwise the identity-checked live value.
    function genesis() public view returns (uint256) {
        uint64 pinned = genesisTimestamp;
        return pinned != 0 ? pinned : configuration().genesisTimestamp;
    }

    /// @notice Permissionless and write-once. The books call it on every booking, challenge and
    /// acceptance, so the calendar is pinned by the first game action at the latest.
    function pinGenesis() public returns (uint64 pinned) {
        pinned = genesisTimestamp;
        if (pinned == 0) {
            pinned = configuration().genesisTimestamp;
            genesisTimestamp = pinned;
            emit GenesisPinned(pinned);
        }
    }

    /// @notice State-changing clock for the books: pins the genesis, then reads the calendar.
    function tick() external returns (uint64 currentRound, uint256 day, uint256 week) {
        pinGenesis();
        return clock();
    }

    function clock() public view returns (uint64 currentRound, uint256 day, uint256 week) {
        uint256 genesis_ = genesis();
        if (block.timestamp < genesis_) revert BeforeGenesis();
        uint256 elapsed = block.timestamp - genesis_;
        uint256 round = elapsed / ROUND_SECONDS + 1;
        if (round > type(uint64).max) revert InvalidConfiguration();
        return (uint64(round), elapsed / 1 days, elapsed / 1 weeks);
    }

    function status() external view returns (uint64 currentRound, uint64 frontier, bool paused, uint256 lag) {
        (currentRound,,) = clock();
        ISqueekCoreV3.CoreState memory state_ = core.state();
        if (state_.settledThroughRound >= currentRound) revert InvalidEndpoint();
        frontier = state_.settledThroughRound;
        paused = state_.paused;
        lag = currentRound - 1 - frontier;
    }

    function weekEnd(uint256 week) public view returns (uint256) {
        return genesis() + (week + 1) * 1 weeks;
    }

    /// @notice Exact physical-work delta for [startRound, startRound+5]. No page truncation is accepted.
    /// Always identity-checked: an upstream change defers settlement instead of inventing work.
    function windowWork(uint64 startRound) external view returns (uint64 work) {
        if (startRound == 0 || startRound > type(uint64).max - 5) revert InvalidWindow();
        ISqueekCoreV3.CoreConfiguration memory config = configuration();
        ISqueekCoreV3.CoreState memory state_ = core.state();
        if (state_.paused) revert CorePaused();
        uint64 endRound = startRound + 5;
        if (endRound > state_.settledThroughRound) {
            revert UnknownRounds(endRound, state_.settledThroughRound);
        }
        if (
            block.timestamp < config.genesisTimestamp
                || state_.settledThroughRound > (block.timestamp - config.genesisTimestamp) / ROUND_SECONDS
        ) revert InvalidEndpoint();
        uint64 beforeRound = startRound - 1;
        ISqueekCoreV3.RoundPage memory before_ = core.roundPage(beforeRound, beforeRound, 0);
        ISqueekCoreV3.RoundPage memory after_ = core.roundPage(endRound, endRound, 0);
        if (
            before_.certifiedThroughRound != beforeRound || after_.certifiedThroughRound != endRound
                || before_.rounds.length != 0 || after_.rounds.length != 0
                || before_.start.cumulativeWork != before_.end.cumulativeWork
                || after_.start.cumulativeWork != after_.end.cumulativeWork
                || after_.end.cumulativeWork < before_.end.cumulativeWork
                || after_.end.cumulativeWork > state_.cumulativeWork
        ) revert InvalidEndpoint();
        work = after_.end.cumulativeWork - before_.end.cumulativeWork;
        if (uint256(work) > uint256(config.maxWorkPerRound) * 6) revert InvalidEndpoint();
    }
}
