// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HamsterRunNFT} from "./HamsterRunNFT.sol";
import {CoreReader} from "./CoreReader.sol";
import {SeasonBoard} from "./SeasonBoard.sol";
import {PointsLedger} from "./PointsLedger.sol";
import {GameMath} from "./lib/GameMath.sol";

/// @notice Free testnet races. Future block hash is publicly verifiable, but validator-influenceable.
/// No wagering, assets at stake or promise that points have future monetary value.
contract MatchBook is ReentrancyGuard {
    uint256 public constant MAX_MATCHES_PER_WEEK = 5;
    uint256 public constant BAND_SIZE = 2000;
    uint256 public constant OPPONENT_COOLDOWN = 1 days;
    uint256 public constant CHALLENGE_TTL = 1 hours;
    uint256 public constant RACE_SECONDS = 15;
    uint256 public constant RANDOMNESS_DELAY_BLOCKS = 2;
    uint256 public constant WIN_POINTS = 10;
    uint256 public constant PARTICIPATION_POINTS = 1;
    HamsterRunNFT public immutable nft;
    PointsLedger public immutable ledger;
    SeasonBoard public immutable board;
    CoreReader public immutable reader;

    enum State {
        None,
        Offered,
        Running,
        Settled,
        Cancelled,
        Expired
    }

    struct Race {
        uint256 first;
        uint256 second;
        address firstOwner;
        address secondOwner;
        uint256 week;
        uint256 offeredAt;
        uint256 readyAt;
        uint256 randomBlock;
        uint256 firstStamina;
        uint256 secondStamina;
        bytes32 seed;
        uint256 firstDistance;
        uint256 secondDistance;
        uint256 winner;
        State state;
    }

    uint256 public nextMatchId = 1;
    mapping(uint256 => Race) private _races;
    mapping(uint256 => uint256) public activeMatch;
    mapping(uint256 => mapping(uint256 => uint256)) public matchesPlayed;
    mapping(uint256 => mapping(address => uint256)) public walletMatchesPlayed;
    mapping(bytes32 => uint256) public pairLastPlayed;
    mapping(bytes32 => uint256) public walletPairLastPlayed;

    error InvalidAddress();
    error NotTokenOwner();
    error InvalidOpponent();
    error TokenBusy();
    error WrongState();
    error ChallengeExpired();
    error BandMismatch();
    error WeeklyLimit();
    error Cooldown();
    error NotReady();
    error RandomnessExpired();
    error CannotExpire();

    event Challenged(uint256 indexed matchId, uint256 indexed first, uint256 indexed second, uint256 week);
    event Accepted(
        uint256 indexed matchId,
        uint256 randomBlock,
        uint256 readyAt,
        uint256 firstStamina,
        uint256 secondStamina
    );
    event RandomnessCaptured(uint256 indexed matchId, bytes32 seed);
    event RaceSettled(
        uint256 indexed matchId, uint256 indexed winner, uint256 firstDistance, uint256 secondDistance
    );
    event RaceClosed(uint256 indexed matchId, State state);

    constructor(address nft_, address ledger_, address board_, address reader_) {
        if (nft_ == address(0) || ledger_ == address(0) || board_ == address(0) || reader_ == address(0)) {
            revert InvalidAddress();
        }
        nft = HamsterRunNFT(nft_);
        ledger = PointsLedger(ledger_);
        board = SeasonBoard(board_);
        reader = CoreReader(reader_);
    }

    function races(uint256 matchId) external view returns (Race memory) {
        return _races[matchId];
    }

    /// @notice Five bands of 2,000 Stamina. The exact cap belongs to the top band, not to a band of its own.
    function band(uint256 stamina) public pure returns (uint256) {
        if (stamina >= GameMath.MAX_STAMINA) stamina = GameMath.MAX_STAMINA - 1;
        return stamina / BAND_SIZE;
    }

    function challenge(uint256 first, uint256 second) external nonReentrant returns (uint256 id) {
        if (nft.ownerOf(first) != msg.sender) revert NotTokenOwner();
        address opponent = nft.ownerOf(second);
        if (first == second || opponent == msg.sender) revert InvalidOpponent();
        if (activeMatch[first] != 0 || activeMatch[second] != 0) revert TokenBusy();
        if (band(nft.stamina(first)) != band(nft.stamina(second))) revert BandMismatch();
        (,, uint256 week) = reader.tick();
        _checkLimit(week, first, msg.sender);
        _checkLimit(week, second, opponent);
        _checkCooldown(first, second, msg.sender, opponent);
        id = nextMatchId++;
        Race storage race = _races[id];
        race.first = first;
        race.second = second;
        race.firstOwner = msg.sender;
        race.secondOwner = opponent;
        race.week = week;
        race.offeredAt = block.timestamp;
        race.state = State.Offered;
        activeMatch[first] = id;
        // Only the consenting challenger is locked. Unsolicited challenges cannot lock opponents.
        nft.setMatchLock(first, true);
        emit Challenged(id, first, second, week);
    }

    function accept(uint256 id) external nonReentrant {
        Race storage race = _races[id];
        if (race.state != State.Offered) revert WrongState();
        if (msg.sender != race.secondOwner || nft.ownerOf(race.second) != msg.sender) revert NotTokenOwner();
        if (activeMatch[race.second] != 0) revert TokenBusy();
        (,, uint256 week) = reader.tick();
        if (week != race.week || block.timestamp >= race.offeredAt + CHALLENGE_TTL) {
            revert ChallengeExpired();
        }
        uint256 firstStamina = nft.stamina(race.first);
        uint256 secondStamina = nft.stamina(race.second);
        if (band(firstStamina) != band(secondStamina)) revert BandMismatch();
        _checkLimit(week, race.first, race.firstOwner);
        _checkLimit(week, race.second, msg.sender);
        _checkCooldown(race.first, race.second, race.firstOwner, msg.sender);
        ++matchesPlayed[week][race.first];
        ++matchesPlayed[week][race.second];
        ++walletMatchesPlayed[week][race.firstOwner];
        ++walletMatchesPlayed[week][msg.sender];
        pairLastPlayed[_pair(race.first, race.second)] = block.timestamp;
        walletPairLastPlayed[_walletPair(race.firstOwner, msg.sender)] = block.timestamp;
        race.state = State.Running;
        race.firstStamina = firstStamina;
        race.secondStamina = secondStamina;
        race.randomBlock = block.number + RANDOMNESS_DELAY_BLOCKS;
        race.readyAt = block.timestamp + RACE_SECONDS;
        activeMatch[race.second] = id;
        nft.setMatchLock(race.second, true);
        board.registerMatch(week, race.first, race.second, race.firstOwner, race.secondOwner);
        emit Accepted(id, race.randomBlock, race.readyAt, firstStamina, secondStamina);
    }

    function _checkLimit(uint256 week, uint256 tokenId, address account) internal view {
        if (
            matchesPlayed[week][tokenId] >= MAX_MATCHES_PER_WEEK
                || walletMatchesPlayed[week][account] >= MAX_MATCHES_PER_WEEK
        ) {
            revert WeeklyLimit();
        }
    }

    function _checkCooldown(uint256 first, uint256 second, address firstOwner, address secondOwner)
        internal
        view
    {
        uint256 last = pairLastPlayed[_pair(first, second)];
        uint256 walletLast = walletPairLastPlayed[_walletPair(firstOwner, secondOwner)];
        if (
            (last != 0 && block.timestamp < last + OPPONENT_COOLDOWN)
                || (walletLast != 0 && block.timestamp < walletLast + OPPONENT_COOLDOWN)
        ) revert Cooldown();
    }

    function _pair(uint256 first, uint256 second) internal pure returns (bytes32) {
        return first < second ? keccak256(abi.encode(first, second)) : keccak256(abi.encode(second, first));
    }

    function _walletPair(address first, address second) internal pure returns (bytes32) {
        return _pair(uint256(uint160(first)), uint256(uint160(second)));
    }

    function captureRandomness(uint256 id) external returns (bytes32) {
        Race storage race = _races[id];
        if (race.state != State.Running) revert WrongState();
        return _capture(id, race);
    }

    function _capture(uint256 id, Race storage race) internal returns (bytes32 seed) {
        if (race.seed != bytes32(0)) return race.seed;
        if (block.number <= race.randomBlock) revert NotReady();
        if (block.number > race.randomBlock + 256) revert RandomnessExpired();
        bytes32 hash = blockhash(race.randomBlock);
        if (hash == bytes32(0)) revert NotReady();
        seed = keccak256(abi.encode(hash, block.chainid, address(this), id));
        race.seed = seed;
        emit RandomnessCaptured(id, seed);
    }

    function settle(uint256 id) external nonReentrant {
        Race storage race = _races[id];
        if (race.state != State.Running) revert WrongState();
        if (block.timestamp < race.readyAt) revert NotReady();
        bytes32 seed = _capture(id, race);
        uint256 firstDistance =
            GameMath.raceDistance(race.firstStamina, uint256(keccak256(abi.encode(seed, uint8(0)))));
        uint256 secondDistance =
            GameMath.raceDistance(race.secondStamina, uint256(keccak256(abi.encode(seed, uint8(1)))));
        bool firstWins = firstDistance > secondDistance
            || (firstDistance == secondDistance && uint256(keccak256(abi.encode(seed, uint8(2)))) % 2 == 0);
        uint256 winner = firstWins ? race.first : race.second;
        race.state = State.Settled;
        race.firstDistance = firstDistance;
        race.secondDistance = secondDistance;
        race.winner = winner;
        _unlock(race, true);
        nft.rewardWinner(winner);
        ledger.award(
            firstWins ? race.firstOwner : race.secondOwner, WIN_POINTS, keccak256(abi.encode("RACE_WIN", id))
        );
        ledger.award(
            firstWins ? race.secondOwner : race.firstOwner,
            PARTICIPATION_POINTS,
            keccak256(abi.encode("RACE_PLAY", id))
        );
        board.recordMatch(race.week, race.first, race.second, firstDistance, secondDistance);
        emit RaceSettled(id, winner, firstDistance, secondDistance);
    }

    function cancel(uint256 id) external nonReentrant {
        Race storage race = _races[id];
        if (race.state != State.Offered) revert WrongState();
        if (msg.sender != race.firstOwner) revert NotTokenOwner();
        race.state = State.Cancelled;
        _unlock(race, false);
        emit RaceClosed(id, race.state);
    }

    function expire(uint256 id) external nonReentrant {
        Race storage race = _races[id];
        bool running = race.state == State.Running;
        if (running) {
            if (race.seed != bytes32(0) || block.number <= race.randomBlock + 256) revert CannotExpire();
        } else if (race.state == State.Offered) {
            // Expiry remains possible even if the upstream implementation changes.
            if (block.timestamp < race.offeredAt + CHALLENGE_TTL) revert CannotExpire();
        } else {
            revert WrongState();
        }
        race.state = State.Expired;
        _unlock(race, running);
        if (running) board.expireMatch(race.week);
        emit RaceClosed(id, race.state);
    }

    function _unlock(Race storage race, bool both) internal {
        activeMatch[race.first] = 0;
        nft.setMatchLock(race.first, false);
        if (both) {
            activeMatch[race.second] = 0;
            nft.setMatchLock(race.second, false);
        }
    }
}
