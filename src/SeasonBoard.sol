// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameAdmin} from "./lib/GameAdmin.sol";
import {CoreReader} from "./CoreReader.sol";
import {HamsterRunNFT} from "./HamsterRunNFT.sol";
import {PointsLedger} from "./PointsLedger.sol";

contract SeasonBoard is GameAdmin {
    /// @notice One physical work unit = one score point; one game race unit = TWO score points.
    uint256 public constant RACE_WORK_WEIGHT = 2;
    uint256 public constant TOP_SIZE = 10;
    HamsterRunNFT public immutable nft;
    PointsLedger public immutable ledger;
    CoreReader public immutable reader;
    address public trainBook;
    address public matchBook;

    struct Entry {
        uint256 trainWork;
        uint256 raceDistance;
        address beneficiary;
    }

    mapping(uint256 => mapping(uint256 => Entry)) public entries;
    mapping(uint256 => uint256[10]) private _leaders;
    mapping(uint256 => uint256) public pendingTrains;
    mapping(uint256 => uint256) public pendingMatches;
    mapping(uint256 => bool) public finalized;
    mapping(uint256 => mapping(uint256 => bool)) public prizeClaimed;

    error WrongWeek();
    error SeasonClosed();
    error SeasonNotReady();
    error NoPrize();

    event BooksConfigured(address indexed trainBook, address indexed matchBook);
    event EntryRegistered(uint256 indexed week, uint256 indexed tokenId, address indexed beneficiary);
    event ScoreChanged(
        uint256 indexed week, uint256 indexed tokenId, uint256 trainWork, uint256 raceDistance
    );
    event SeasonFinalized(uint256 indexed week);
    event PrizeClaimed(
        uint256 indexed week, uint256 indexed tokenId, address indexed beneficiary, uint256 points
    );

    constructor(address owner_, address nft_, address ledger_, address reader_) GameAdmin(owner_) {
        if (nft_ == address(0) || ledger_ == address(0) || reader_ == address(0)) revert InvalidAddress();
        nft = HamsterRunNFT(nft_);
        ledger = PointsLedger(ledger_);
        reader = CoreReader(reader_);
    }

    function configureBooks(address train_, address match_) external onlyOwner {
        if (trainBook != address(0)) revert AlreadyConfigured();
        _requireContract(train_);
        _requireContract(match_);
        if (train_ == match_) revert InvalidAddress();
        trainBook = train_;
        matchBook = match_;
        emit BooksConfigured(train_, match_);
    }

    function registerTrain(uint256 week, uint256 tokenId, address beneficiary) external {
        if (msg.sender != trainBook) revert Unauthorized();
        _register(week, tokenId, beneficiary);
        ++pendingTrains[week];
    }

    function recordTrain(uint256 week, uint256 tokenId, uint64 work) external {
        if (msg.sender != trainBook) revert Unauthorized();
        if (finalized[week]) revert SeasonClosed();
        --pendingTrains[week];
        entries[week][tokenId].trainWork += work;
        _updateTop(week, tokenId);
    }

    function registerMatch(
        uint256 week,
        uint256 first,
        uint256 second,
        address firstOwner,
        address secondOwner
    ) external {
        if (msg.sender != matchBook) revert Unauthorized();
        _register(week, first, firstOwner);
        _register(week, second, secondOwner);
        ++pendingMatches[week];
    }

    function recordMatch(
        uint256 week,
        uint256 first,
        uint256 second,
        uint256 firstDistance,
        uint256 secondDistance
    ) external {
        if (msg.sender != matchBook) revert Unauthorized();
        if (finalized[week]) revert SeasonClosed();
        --pendingMatches[week];
        entries[week][first].raceDistance += firstDistance;
        entries[week][second].raceDistance += secondDistance;
        _updateTop(week, first);
        _updateTop(week, second);
    }

    /// @notice Expiry is an unplayed match, not a zero-distance result. Quotas remain consumed.
    function expireMatch(uint256 week) external {
        if (msg.sender != matchBook) revert Unauthorized();
        --pendingMatches[week];
    }

    function _register(uint256 week, uint256 tokenId, address beneficiary) internal {
        (,, uint256 currentWeek) = reader.clock();
        if (week != currentWeek) revert WrongWeek();
        if (finalized[week]) revert SeasonClosed();
        if (nft.ownerOf(tokenId) != beneficiary) revert Unauthorized();
        Entry storage entry = entries[week][tokenId];
        if (entry.beneficiary == address(0)) {
            entry.beneficiary = beneficiary;
            emit EntryRegistered(week, tokenId, beneficiary);
        }
    }

    function score(uint256 week, uint256 tokenId) public view returns (uint256) {
        Entry storage entry = entries[week][tokenId];
        return entry.trainWork + RACE_WORK_WEIGHT * entry.raceDistance;
    }

    function leaders(uint256 week) external view returns (uint256[10] memory) {
        return _leaders[week];
    }

    /// @dev Scores only increase. Remove the updated token, then insert it into the sorted top ten.
    /// Ties favor the smaller token ID. Work is bounded by 20 slots, independent of collection size.
    function _updateTop(uint256 week, uint256 tokenId) internal {
        Entry storage entry = entries[week][tokenId];
        emit ScoreChanged(week, tokenId, entry.trainWork, entry.raceDistance);
        uint256[10] storage list = _leaders[week];
        for (uint256 i; i < TOP_SIZE; ++i) {
            if (list[i] == tokenId) {
                for (uint256 j = i; j + 1 < TOP_SIZE; ++j) {
                    list[j] = list[j + 1];
                }
                list[TOP_SIZE - 1] = 0;
                break;
            }
        }
        uint256 value = score(week, tokenId);
        if (value == 0) return;
        for (uint256 i; i < TOP_SIZE; ++i) {
            uint256 other = list[i];
            if (other == 0 || value > score(week, other) || (value == score(week, other) && tokenId < other))
            {
                for (uint256 j = TOP_SIZE - 1; j > i; --j) {
                    list[j] = list[j - 1];
                }
                list[i] = tokenId;
                break;
            }
        }
    }

    function finalize(uint256 week) external {
        if (finalized[week]) revert SeasonClosed();
        if (block.timestamp < reader.weekEnd(week) || pendingTrains[week] != 0 || pendingMatches[week] != 0) {
            revert SeasonNotReady();
        }
        finalized[week] = true;
        emit SeasonFinalized(week);
    }

    function prize(uint256 week, uint256 tokenId) public view returns (uint256) {
        if (!finalized[week] || tokenId == 0) return 0;
        uint256[10] storage list = _leaders[week];
        for (uint256 i; i < TOP_SIZE; ++i) {
            if (list[i] == tokenId) return i == 0 ? 300 : (i < 3 ? 150 : 50);
        }
        return 0;
    }

    function claimPrize(uint256 week, uint256 tokenId) external {
        uint256 amount = prize(week, tokenId);
        if (amount == 0 || prizeClaimed[week][tokenId]) revert NoPrize();
        prizeClaimed[week][tokenId] = true;
        address beneficiary = entries[week][tokenId].beneficiary;
        ledger.award(beneficiary, amount, keccak256(abi.encode("SEASON", week, tokenId)));
        emit PrizeClaimed(week, tokenId, beneficiary, amount);
    }
}
