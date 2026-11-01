// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HamsterRunNFT} from "./HamsterRunNFT.sol";
import {CoreReader} from "./CoreReader.sol";
import {SeasonBoard} from "./SeasonBoard.sol";

contract TrainBook is ReentrancyGuard {
    HamsterRunNFT public immutable nft;
    CoreReader public immutable reader;
    SeasonBoard public immutable board;
    uint256 public constant WINDOW_ROUNDS = 6;

    struct Booking {
        uint64 startRound;
        bool settled;
        uint64 trainWork;
    }

    mapping(uint256 => mapping(uint256 => Booking)) public bookings;
    error InvalidAddress();
    error NotTokenOwner();
    error AlreadyBooked();
    error InvalidWindow();
    error NoPendingBooking();

    event WindowBooked(
        uint256 indexed tokenId, uint256 indexed day, uint64 startRound, address indexed owner
    );
    event TrainSettled(uint256 indexed tokenId, uint256 indexed day, uint64 work, uint256 staminaGain);

    constructor(address nft_, address reader_, address board_) {
        if (nft_ == address(0) || reader_ == address(0) || board_ == address(0)) revert InvalidAddress();
        nft = HamsterRunNFT(nft_);
        reader = CoreReader(reader_);
        board = SeasonBoard(board_);
    }

    /// @notice Book six wholly future rounds inside the CURRENT genesis-aligned day.
    /// No catch-up bookings and no reading partial work before selecting a window.
    function book(uint256 tokenId, uint64 startRound) external nonReentrant {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        (uint64 currentRound, uint256 day, uint256 week) = reader.clock();
        if (bookings[tokenId][day].startRound != 0) revert AlreadyBooked();
        if (
            startRound <= currentRound || (uint256(startRound) - 1) / 144 != day
                || (uint256(startRound) + 4) / 144 != day
        ) revert InvalidWindow();
        bookings[tokenId][day].startRound = startRound;
        board.registerTrain(week, tokenId, msg.sender);
        emit WindowBooked(tokenId, day, startRound, msg.sender);
    }

    /// @notice Anyone may settle; gain stays with the NFT. Unknown or paused reads revert atomically.
    function settle(uint256 tokenId, uint256 day) external nonReentrant returns (uint64 work, uint256 gain) {
        Booking storage booking = bookings[tokenId][day];
        if (booking.startRound == 0 || booking.settled) revert NoPendingBooking();
        work = reader.windowWork(booking.startRound);
        booking.settled = true;
        booking.trainWork = work;
        gain = nft.applyTraining(tokenId, work);
        board.recordTrain(day / 7, tokenId, work);
        emit TrainSettled(tokenId, day, work, gain);
    }
}
