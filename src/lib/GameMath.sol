// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library GameMath {
    uint256 internal constant MAX_STAMINA = 10_000;

    /// @dev Saturates in work and diminishes in existing Stamina; integer dust earns no gain.
    function trainGain(uint64 work, uint256 stamina) internal pure returns (uint256) {
        if (stamina >= MAX_STAMINA || work == 0) return 0;
        uint256 gain = (200 * uint256(work) * 1000) / ((uint256(work) + 1000) * (1000 + stamina));
        return gain > MAX_STAMINA - stamina ? MAX_STAMINA - stamina : gain;
    }

    /// @dev Independent uniform noise in [0,9999]; the Stamina bonus is always < 2000.
    /// A maximal bonus difference therefore has win probability below 68% (including half of ties).
    function raceDistance(uint256 stamina, uint256 randomWord) internal pure returns (uint256) {
        if (stamina > MAX_STAMINA) stamina = MAX_STAMINA;
        return 10_000 + (2000 * stamina) / (stamina + 200) + randomWord % 10_000;
    }
}
