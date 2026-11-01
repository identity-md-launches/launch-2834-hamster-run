// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameAdmin} from "./lib/GameAdmin.sol";

/// @notice Wallet-bound counters, deliberately not an ERC-20. No transfers, approvals or redemption.
contract PointsLedger is GameAdmin {
    address public matchBook;
    address public seasonBoard;
    mapping(address => uint256) public points;
    uint256 public totalPoints;

    event WritersConfigured(address indexed matchBook, address indexed seasonBoard);
    event PointsAwarded(
        address indexed account, uint256 amount, address indexed writer, bytes32 indexed awardId
    );

    constructor(address owner_) GameAdmin(owner_) {}

    function configureWriters(address match_, address board_) external onlyOwner {
        if (matchBook != address(0)) revert AlreadyConfigured();
        _requireContract(match_);
        _requireContract(board_);
        if (match_ == board_) revert InvalidAddress();
        matchBook = match_;
        seasonBoard = board_;
        emit WritersConfigured(match_, board_);
    }

    function award(address account, uint256 amount, bytes32 awardId) external {
        if (msg.sender != matchBook && msg.sender != seasonBoard) revert Unauthorized();
        if (account == address(0)) revert InvalidAddress();
        points[account] += amount;
        totalPoints += amount;
        emit PointsAwarded(account, amount, msg.sender, awardId);
    }
}
