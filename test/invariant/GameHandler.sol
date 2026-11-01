// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockCore} from "../mocks/MockCore.sol";
import {CoreReader} from "../../src/CoreReader.sol";
import {HamsterRunNFT} from "../../src/HamsterRunNFT.sol";
import {PointsLedger} from "../../src/PointsLedger.sol";
import {SeasonBoard} from "../../src/SeasonBoard.sol";
import {TrainBook} from "../../src/TrainBook.sol";
import {MatchBook} from "../../src/MatchBook.sol";
import {GameMath} from "../../src/lib/GameMath.sol";

/// @dev Drives the whole game graph with bounded inputs and several wallets. Every action predicts
/// whether the call must succeed or which error it must revert with, and keeps an independent model
/// (ghosts) of points, pending season liabilities, certified work and scores.
contract GameHandler is Test {
    uint256 internal constant ACTORS = 4;
    uint256 internal constant MAX_TOKENS = 20;

    MockCore public core;
    CoreReader public reader;
    HamsterRunNFT public nft;
    PointsLedger public ledger;
    SeasonBoard public board;
    TrainBook public train;
    MatchBook public matches;
    address public admin;
    uint64 public genesis;
    address[ACTORS] internal _actors;

    // Clock model (handler calls re-apply it so time is monotonic across the sequence).
    uint256 public currentTime;
    uint256 public currentBlock;

    // Core model: cumulative physical work per certified round.
    uint64 public frontier;
    uint64 public cumWork;
    mapping(uint64 => uint64) public cumAt;
    bool public paused;

    // Game model.
    mapping(address => uint256) public ghostPoints;
    uint256 public ghostTotalPoints;
    mapping(uint256 => uint256) public ghostPendingTrains;
    mapping(uint256 => uint256) public ghostPendingMatches;
    mapping(uint256 => bool) public ghostFinalized;
    mapping(uint256 => mapping(uint256 => uint256)) public ghostTrainWork;
    mapping(uint256 => mapping(uint256 => uint256)) public ghostRaceDistance;
    mapping(uint256 => uint256) public ghostPrizePaid;
    /// Bookings still pending when their week was grace-finalized (excluded from the board).
    mapping(uint256 => uint256) public ghostExcluded;
    mapping(uint256 => uint256) public lastStamina;
    uint256 public maxWeek;
    uint256 public ghostSupply;

    struct PendingTrain {
        uint256 tokenId;
        uint256 day;
    }

    PendingTrain[] internal _pendingTrains;
    uint256[] internal _raceIds;
    uint64[] internal _endpoints;

    // Coverage counters, so a vacuous run is visible.
    uint256 public trainsBooked;
    uint256 public trainsSettled;
    uint256 public zeroWorkSettles;
    uint256 public unknownRejected;
    uint256 public pausedRejected;
    uint256 public racesAccepted;
    uint256 public racesSettled;
    uint256 public racesExpired;
    uint256 public seasonsFinalized;
    uint256 public prizesClaimed;
    uint256 public graceFinalizations;
    uint256 public lateTrainsExcluded;

    constructor(
        MockCore core_,
        CoreReader reader_,
        HamsterRunNFT nft_,
        PointsLedger ledger_,
        SeasonBoard board_,
        TrainBook train_,
        MatchBook matches_,
        address admin_,
        address[ACTORS] memory actors_,
        uint64 genesis_
    ) {
        core = core_;
        reader = reader_;
        nft = nft_;
        ledger = ledger_;
        board = board_;
        train = train_;
        matches = matches_;
        admin = admin_;
        _actors = actors_;
        genesis = genesis_;
        currentTime = block.timestamp;
        currentBlock = block.number;
        ghostSupply = nft_.totalSupply();
    }

    modifier synced() {
        vm.warp(currentTime);
        vm.roll(currentBlock);
        _;
        _checkStaminaMonotonic();
    }

    // ---------------------------------------------------------------- views for the invariants

    function actors() external view returns (address[ACTORS] memory) {
        return _actors;
    }

    function raceCount() external view returns (uint256) {
        return _raceIds.length;
    }

    function pendingTrainCount() external view returns (uint256) {
        return _pendingTrains.length;
    }

    // ---------------------------------------------------------------- time and Core

    function warp(uint256 secondsSeed) external synced {
        uint256 delta =
            secondsSeed % 8 == 0 ? bound(secondsSeed, 1 days, 4 days) : bound(secondsSeed, 1, 6 hours);
        currentTime += delta;
        currentBlock += 1 + delta / 120;
        vm.warp(currentTime);
        vm.roll(currentBlock);
        _trackWeek();
    }

    function rollBlocks(uint256 blocksSeed) external synced {
        uint256 n = bound(blocksSeed, 1, 300);
        currentBlock += n;
        currentTime += n * 12;
        vm.warp(currentTime);
        vm.roll(currentBlock);
        _trackWeek();
    }

    /// @dev Certifies closed rounds up to a bounded target. Only booked endpoints and the frontier get
    /// checkpoints (all the reader consumes); each segment carries at most 10,000 work per round and a
    /// quarter of segments carry true zero work.
    function advanceCore(uint256 roundsSeed, uint256 workSeed) external synced {
        uint64 completed = uint64((currentTime - genesis) / 600);
        if (frontier >= completed) return;
        uint64 target = frontier + uint64(bound(roundsSeed, 1, 600));
        if (target > completed) target = completed;
        _certifyThrough(target, workSeed);
    }

    function _certifyThrough(uint64 target, uint256 workSeed) internal {
        if (target <= frontier) return;
        uint64[] memory points = new uint64[](_endpoints.length + 1);
        uint256 n;
        uint256 kept;
        for (uint256 i; i < _endpoints.length; ++i) {
            uint64 e = _endpoints[i];
            if (e < target) points[n++] = e;
            else if (e > target) _endpoints[kept++] = e;
        }
        while (_endpoints.length > kept) _endpoints.pop();
        for (uint256 i = 1; i < n; ++i) {
            uint64 key = points[i];
            uint256 j = i;
            while (j > 0 && points[j - 1] > key) {
                points[j] = points[j - 1];
                --j;
            }
            points[j] = key;
        }
        points[n++] = target;
        uint64 prev = frontier;
        for (uint256 i; i < n; ++i) {
            uint64 r = points[i];
            if (r == prev) continue;
            uint256 word = uint256(keccak256(abi.encode(workSeed, r)));
            uint64 work = word % 4 == 0 ? 0 : uint64((word >> 8) % (uint256(r - prev) * 10_000 + 1));
            cumWork += work;
            cumAt[r] = cumWork;
            core.setPoint(r, cumWork, uint96(r) * 1e9);
            prev = r;
        }
        frontier = target;
        core.setFrontier(target);
    }

    /// @dev A keeper waits for a booked window to close, Core resumes and certifies, then settles.
    function keeperTrain(uint256 indexSeed, uint256 workSeed) external {
        if (_pendingTrains.length == 0) return;
        uint256 index = bound(indexSeed, 0, _pendingTrains.length - 1);
        PendingTrain memory pending = _pendingTrains[index];
        (uint64 start,,) = train.bookings(pending.tokenId, pending.day);
        _advanceTo(uint256(genesis) + uint256(start + 5) * 600);
        _resumeAndCertify(workSeed);
        this.settleTrain(index);
    }

    /// @dev Closes a week the way an operator would: settle what is certified, settle or release
    /// accepted races, then finalize.
    function keeperFinalize(uint256 weekSeed, uint256 workSeed) external {
        uint256 week = bound(weekSeed, 0, maxWeek);
        if (ghostFinalized[week]) return;
        _advanceTo(uint256(genesis) + (week + 1) * 1 weeks);
        _resumeAndCertify(workSeed);
        for (uint256 i = _pendingTrains.length; i > 0; --i) {
            this.settleTrain(i - 1);
        }
        for (uint256 i; i < _raceIds.length; ++i) {
            if (matches.races(_raceIds[i]).state != MatchBook.State.Running) continue;
            this.settleRace(i, 1);
            if (matches.races(_raceIds[i]).state == MatchBook.State.Running) this.expire(i);
        }
        this.finalize(week);
        assertTrue(ghostFinalized[week], "keeper could not finalize a closed week");
    }

    /// @dev Core stalls: the grace period passes without certification, accepted races are settled
    /// or expired, and the week is finalized with its uncertified bookings excluded (never zeroed).
    function graceFinalize(uint256 weekSeed) external {
        // Prefer the week of a still-pending booking, so the exclusion path is actually exercised.
        uint256 week = _pendingTrains.length == 0
            ? bound(weekSeed, 0, maxWeek)
            : _pendingTrains[weekSeed % _pendingTrains.length].day / 7;
        if (ghostFinalized[week]) return;
        _advanceTo(uint256(genesis) + (week + 1) * 1 weeks + 2 weeks);
        for (uint256 i; i < _raceIds.length; ++i) {
            if (matches.races(_raceIds[i]).state != MatchBook.State.Running) continue;
            this.settleRace(i, 1);
            if (matches.races(_raceIds[i]).state == MatchBook.State.Running) {
                currentBlock += 257;
                this.expire(i);
            }
        }
        this.finalize(week);
        assertTrue(ghostFinalized[week], "grace did not let a stalled week finalize");
    }

    /// @dev Claims a listed prize of a finalized week (if any) on behalf of its beneficiary.
    function keeperClaim(uint256 weekSeed, uint256 slotSeed) external {
        uint256 week = bound(weekSeed, 0, maxWeek);
        for (uint256 w; w <= maxWeek; ++w) {
            uint256 candidate = (week + w) % (maxWeek + 1);
            if (!ghostFinalized[candidate]) continue;
            uint256 tokenId = board.leaders(candidate)[slotSeed % 10];
            if (tokenId == 0) tokenId = board.leaders(candidate)[0];
            if (tokenId == 0) continue;
            this.claimPrize(candidate, tokenId);
            return;
        }
    }

    function _advanceTo(uint256 time) internal {
        if (currentTime < time) {
            currentBlock += 1 + (time - currentTime) / 12;
            currentTime = time;
            _trackWeek();
        }
    }

    function _resumeAndCertify(uint256 workSeed) internal {
        vm.warp(currentTime);
        vm.roll(currentBlock);
        if (paused) {
            paused = false;
            core.setPaused(false);
        }
        _certifyThrough(uint64((currentTime - genesis) / 600), workSeed);
    }

    function togglePause(uint256 seed) external synced {
        // Pausing is rarer than resuming so certified work still settles most of the time.
        if (!paused && seed % 4 != 0) return;
        paused = !paused;
        core.setPaused(paused);
    }

    // ---------------------------------------------------------------- NFT

    function ownerMint(uint256 actorSeed, uint256 quantitySeed) external synced {
        uint256 quantity = bound(quantitySeed, 1, 3);
        if (ghostSupply + quantity > MAX_TOKENS) return;
        address to = _actor(actorSeed);
        vm.prank(admin);
        nft.ownerMint(to, quantity);
        ghostSupply += quantity;
        assertEq(nft.totalSupply(), ghostSupply, "owner mint supply");
    }

    function transfer(uint256 tokenSeed, uint256 actorSeed) external synced {
        uint256 tokenId = _token(tokenSeed);
        address from = nft.ownerOf(tokenId);
        address to = _actor(actorSeed);
        bool locked = nft.matchLocked(tokenId);
        if (locked) {
            vm.prank(from);
            vm.expectRevert(HamsterRunNFT.InMatch.selector);
            nft.transferFrom(from, to, tokenId);
            assertEq(nft.ownerOf(tokenId), from, "locked NFT moved");
            return;
        }
        vm.prank(from);
        nft.transferFrom(from, to, tokenId);
        assertEq(nft.ownerOf(tokenId), to);
    }

    // ---------------------------------------------------------------- training

    function book(uint256 tokenSeed, uint256 offsetSeed) external synced {
        uint256 tokenId = _token(tokenSeed);
        address owner_ = nft.ownerOf(tokenId);
        (uint64 round, uint256 day, uint256 week) = reader.clock();
        uint64 start = round + 1 + uint64(bound(offsetSeed, 0, 150));
        (uint64 existing,,) = train.bookings(tokenId, day);
        vm.prank(owner_);
        if (existing != 0) {
            vm.expectRevert(TrainBook.AlreadyBooked.selector);
            train.book(tokenId, start);
            return;
        }
        if (uint256(start) + 5 > (day + 1) * 144) {
            vm.expectRevert(TrainBook.InvalidWindow.selector);
            train.book(tokenId, start);
            return;
        }
        train.book(tokenId, start);
        ++ghostPendingTrains[week];
        ++trainsBooked;
        _pendingTrains.push(PendingTrain(tokenId, day));
        _endpoints.push(start - 1);
        _endpoints.push(start + 5);
        (uint64 stored, bool settled,) = train.bookings(tokenId, day);
        assertEq(stored, start);
        assertFalse(settled);
    }

    function bookPast(uint256 tokenSeed, uint256 backSeed) external synced {
        uint256 tokenId = _token(tokenSeed);
        (uint64 round, uint256 day,) = reader.clock();
        uint64 start = round - uint64(bound(backSeed, 0, round - 1));
        (uint64 existing,,) = train.bookings(tokenId, day);
        vm.prank(nft.ownerOf(tokenId));
        vm.expectRevert(existing != 0 ? TrainBook.AlreadyBooked.selector : TrainBook.InvalidWindow.selector);
        train.book(tokenId, start);
    }

    function settleTrain(uint256 indexSeed) external synced {
        if (_pendingTrains.length == 0) return;
        uint256 index = bound(indexSeed, 0, _pendingTrains.length - 1);
        PendingTrain memory pending = _pendingTrains[index];
        (uint64 start, bool settled,) = train.bookings(pending.tokenId, pending.day);
        assertFalse(settled, "pending booking already settled");
        uint64 end = start + 5;
        uint256 week = pending.day / 7;
        uint256 before = nft.stamina(pending.tokenId);
        if (paused) {
            vm.expectRevert(CoreReader.CorePaused.selector);
            train.settle(pending.tokenId, pending.day);
            ++pausedRejected;
            return;
        }
        if (end > frontier) {
            vm.expectRevert(abi.encodeWithSelector(CoreReader.UnknownRounds.selector, end, frontier));
            train.settle(pending.tokenId, pending.day);
            ++unknownRejected;
            return;
        }
        bool late = ghostFinalized[week];
        if (late) assertGt(ghostExcluded[week], 0, "week finalized with an unexcluded pending train");
        bytes32 tableBefore = _table(week, pending.tokenId);
        (uint64 work, uint256 gain) = train.settle(pending.tokenId, pending.day);
        uint64 expectedWork = cumAt[end] - cumAt[start - 1];
        assertEq(work, expectedWork, "train work is not the certified physical work delta");
        assertEq(gain, GameMath.trainGain(expectedWork, before), "gain formula");
        if (expectedWork == 0) {
            assertEq(gain, 0, "zero work produced Stamina");
            ++zeroWorkSettles;
        }
        assertEq(nft.stamina(pending.tokenId), before + gain);
        (, bool nowSettled, uint64 recorded) = train.bookings(pending.tokenId, pending.day);
        assertTrue(nowSettled);
        assertEq(recorded, expectedWork);
        --ghostPendingTrains[week];
        if (late) {
            // A finalized table never changes; the NFT still trained above.
            assertEq(_table(week, pending.tokenId), tableBefore, "late train rewrote a final table");
            ++lateTrainsExcluded;
        } else {
            ghostTrainWork[week][pending.tokenId] += expectedWork;
        }
        ++trainsSettled;
        _pendingTrains[index] = _pendingTrains[_pendingTrains.length - 1];
        _pendingTrains.pop();
        vm.expectRevert(TrainBook.NoPendingBooking.selector);
        train.settle(pending.tokenId, pending.day);
    }

    // ---------------------------------------------------------------- races

    function challenge(uint256 firstSeed, uint256 secondSeed) external synced {
        uint256 first = _token(firstSeed);
        uint256 second = _token(secondSeed);
        address firstOwner = nft.ownerOf(first);
        address secondOwner = nft.ownerOf(second);
        (,, uint256 week) = reader.clock();
        bytes4 expected;
        if (first == second || firstOwner == secondOwner) {
            expected = MatchBook.InvalidOpponent.selector;
        } else if (matches.activeMatch(first) != 0 || matches.activeMatch(second) != 0) {
            expected = MatchBook.TokenBusy.selector;
        } else if (_band(nft.stamina(first)) != _band(nft.stamina(second))) {
            expected = MatchBook.BandMismatch.selector;
        } else if (_overLimit(week, first, firstOwner) || _overLimit(week, second, secondOwner)) {
            expected = MatchBook.WeeklyLimit.selector;
        } else if (_cooling(first, second, firstOwner, secondOwner)) {
            expected = MatchBook.Cooldown.selector;
        }
        vm.prank(firstOwner);
        if (expected != bytes4(0)) {
            vm.expectRevert(expected);
            matches.challenge(first, second);
            return;
        }
        uint256 id = matches.challenge(first, second);
        _raceIds.push(id);
        assertTrue(nft.matchLocked(first));
        assertFalse(nft.matchLocked(second), "unsolicited challenge locked the opponent");
    }

    function accept(uint256 idSeed, uint256 callerSeed) external synced {
        if (_raceIds.length == 0) return;
        uint256 id = _raceIds[bound(idSeed, 0, _raceIds.length - 1)];
        MatchBook.Race memory race = matches.races(id);
        // One call in four comes from an arbitrary wallet.
        address caller = callerSeed % 4 == 0 ? _actor(callerSeed >> 2) : race.secondOwner;
        (,, uint256 week) = reader.clock();
        bytes4 expected;
        if (race.state != MatchBook.State.Offered) {
            expected = MatchBook.WrongState.selector;
        } else if (caller != race.secondOwner || nft.ownerOf(race.second) != caller) {
            expected = MatchBook.NotTokenOwner.selector;
        } else if (matches.activeMatch(race.second) != 0) {
            expected = MatchBook.TokenBusy.selector;
        } else if (week != race.week || currentTime >= race.offeredAt + 1 hours) {
            expected = MatchBook.ChallengeExpired.selector;
        } else if (_band(nft.stamina(race.first)) != _band(nft.stamina(race.second))) {
            expected = MatchBook.BandMismatch.selector;
        } else if (_overLimit(week, race.first, race.firstOwner) || _overLimit(week, race.second, caller)) {
            expected = MatchBook.WeeklyLimit.selector;
        } else if (_cooling(race.first, race.second, race.firstOwner, caller)) {
            expected = MatchBook.Cooldown.selector;
        }
        vm.prank(caller);
        if (expected != bytes4(0)) {
            vm.expectRevert(expected);
            matches.accept(id);
            return;
        }
        matches.accept(id);
        ++ghostPendingMatches[week];
        ++racesAccepted;
        race = matches.races(id);
        assertEq(race.firstStamina, nft.stamina(race.first));
        assertEq(race.secondStamina, nft.stamina(race.second));
        assertEq(race.randomBlock, currentBlock + 2);
        assertEq(race.readyAt, currentTime + 15);
        assertLe(matches.matchesPlayed(week, race.first), 5);
        assertLe(matches.walletMatchesPlayed(week, race.firstOwner), 5);
        assertLe(matches.walletMatchesPlayed(week, race.secondOwner), 5);
    }

    /// @dev Offer and acceptance in consecutive calls, so races are not starved by the one-hour TTL.
    function challengeAndAccept(uint256 firstSeed, uint256 secondSeed) external {
        uint256 before = _raceIds.length;
        this.challenge(firstSeed, secondSeed);
        if (_raceIds.length == before) return;
        this.accept(_raceIds.length - 1, 1);
    }

    function cancel(uint256 idSeed, uint256 callerSeed) external synced {
        if (_raceIds.length == 0) return;
        uint256 id = _raceIds[bound(idSeed, 0, _raceIds.length - 1)];
        MatchBook.Race memory race = matches.races(id);
        address caller = callerSeed % 3 == 0 ? _actor(callerSeed >> 2) : race.firstOwner;
        vm.prank(caller);
        if (race.state != MatchBook.State.Offered) {
            vm.expectRevert(MatchBook.WrongState.selector);
        } else if (caller != race.firstOwner) {
            vm.expectRevert(MatchBook.NotTokenOwner.selector);
        }
        matches.cancel(id);
    }

    function captureRandomness(uint256 idSeed) external synced {
        if (_raceIds.length == 0) return;
        uint256 id = _raceIds[bound(idSeed, 0, _raceIds.length - 1)];
        MatchBook.Race memory race = matches.races(id);
        if (race.state != MatchBook.State.Running) {
            vm.expectRevert(MatchBook.WrongState.selector);
            matches.captureRandomness(id);
            return;
        }
        if (race.seed != bytes32(0)) {
            assertEq(matches.captureRandomness(id), race.seed, "saved seed was rerolled");
            return;
        }
        if (currentBlock <= race.randomBlock) {
            vm.expectRevert(MatchBook.NotReady.selector);
            matches.captureRandomness(id);
            return;
        }
        if (currentBlock > race.randomBlock + 256) {
            vm.expectRevert(MatchBook.RandomnessExpired.selector);
            matches.captureRandomness(id);
            return;
        }
        vm.setBlockhash(race.randomBlock, keccak256(abi.encode("hash", id, race.randomBlock)));
        bytes32 seed = matches.captureRandomness(id);
        assertTrue(seed != bytes32(0));
    }

    function settleRace(uint256 idSeed, uint256 waitSeed) external synced {
        if (_raceIds.length == 0) return;
        uint256 id = _raceIds[bound(idSeed, 0, _raceIds.length - 1)];
        MatchBook.Race memory race = matches.races(id);
        if (race.state != MatchBook.State.Running) {
            vm.expectRevert(MatchBook.WrongState.selector);
            matches.settle(id);
            return;
        }
        // Usually wait for the race to be ready; sometimes try early.
        if (waitSeed % 5 != 0) {
            if (currentTime < race.readyAt) currentTime = race.readyAt;
            if (currentBlock <= race.randomBlock) currentBlock = race.randomBlock + 1;
            vm.warp(currentTime);
            vm.roll(currentBlock);
            _trackWeek();
        }
        if (currentTime < race.readyAt) {
            vm.expectRevert(MatchBook.NotReady.selector);
            matches.settle(id);
            return;
        }
        if (race.seed == bytes32(0)) {
            if (currentBlock <= race.randomBlock) {
                vm.expectRevert(MatchBook.NotReady.selector);
                matches.settle(id);
                return;
            }
            if (currentBlock > race.randomBlock + 256) {
                vm.expectRevert(MatchBook.RandomnessExpired.selector);
                matches.settle(id);
                return;
            }
            vm.setBlockhash(race.randomBlock, keccak256(abi.encode("hash", id, race.randomBlock)));
        }
        assertFalse(ghostFinalized[race.week], "week finalized with a running race");
        uint256 firstBefore = nft.stamina(race.first);
        uint256 secondBefore = nft.stamina(race.second);
        matches.settle(id);
        race = matches.races(id);
        uint256 firstDistance =
            GameMath.raceDistance(race.firstStamina, uint256(keccak256(abi.encode(race.seed, uint8(0)))));
        uint256 secondDistance =
            GameMath.raceDistance(race.secondStamina, uint256(keccak256(abi.encode(race.seed, uint8(1)))));
        assertEq(race.firstDistance, firstDistance);
        assertEq(race.secondDistance, secondDistance);
        bool firstWins = race.winner == race.first;
        assertTrue(firstWins || race.winner == race.second);
        if (firstDistance != secondDistance) {
            assertEq(firstWins, firstDistance > secondDistance, "slower runner won");
        }
        address winnerOwner = firstWins ? race.firstOwner : race.secondOwner;
        address loserOwner = firstWins ? race.secondOwner : race.firstOwner;
        _award(winnerOwner, 10);
        _award(loserOwner, 1);
        uint256 winnerBefore = firstWins ? firstBefore : secondBefore;
        uint256 loserBefore = firstWins ? secondBefore : firstBefore;
        uint256 expectedWinner = winnerBefore + 2 > 10_000 ? 10_000 : winnerBefore + 2;
        assertEq(nft.stamina(race.winner), expectedWinner, "winner bump");
        assertEq(nft.stamina(firstWins ? race.second : race.first), loserBefore, "loser Stamina changed");
        ghostRaceDistance[race.week][race.first] += firstDistance;
        ghostRaceDistance[race.week][race.second] += secondDistance;
        --ghostPendingMatches[race.week];
        ++racesSettled;
    }

    function expire(uint256 idSeed) external synced {
        if (_raceIds.length == 0) return;
        uint256 id = _raceIds[bound(idSeed, 0, _raceIds.length - 1)];
        MatchBook.Race memory race = matches.races(id);
        bool running = race.state == MatchBook.State.Running;
        if (running) {
            if (race.seed != bytes32(0) || currentBlock <= race.randomBlock + 256) {
                vm.expectRevert(MatchBook.CannotExpire.selector);
                matches.expire(id);
                return;
            }
        } else if (race.state == MatchBook.State.Offered) {
            if (currentTime < race.offeredAt + 1 hours) {
                vm.expectRevert(MatchBook.CannotExpire.selector);
                matches.expire(id);
                return;
            }
        } else {
            vm.expectRevert(MatchBook.WrongState.selector);
            matches.expire(id);
            return;
        }
        uint256 pointsBefore = ledger.totalPoints();
        matches.expire(id);
        assertEq(ledger.totalPoints(), pointsBefore, "expiry awarded points");
        if (running) {
            --ghostPendingMatches[race.week];
            ++racesExpired;
        }
    }

    // ---------------------------------------------------------------- season

    function finalize(uint256 weekSeed) external synced {
        uint256 week = bound(weekSeed, 0, maxWeek + 1);
        if (ghostFinalized[week]) {
            vm.expectRevert(SeasonBoard.SeasonClosed.selector);
            board.finalize(week);
            return;
        }
        uint256 end = uint256(genesis) + (week + 1) * 1 weeks;
        if (
            currentTime < end || ghostPendingMatches[week] != 0
                || (ghostPendingTrains[week] != 0 && currentTime < end + 2 weeks)
        ) {
            vm.expectRevert(SeasonBoard.SeasonNotReady.selector);
            board.finalize(week);
            return;
        }
        vm.expectEmit(true, false, false, true, address(board));
        emit SeasonBoard.SeasonFinalized(week, ghostPendingTrains[week]);
        board.finalize(week);
        ghostFinalized[week] = true;
        ghostExcluded[week] = ghostPendingTrains[week];
        if (ghostPendingTrains[week] != 0) ++graceFinalizations;
        ++seasonsFinalized;
    }

    function claimPrize(uint256 weekSeed, uint256 tokenSeed) external synced {
        uint256 week = bound(weekSeed, 0, maxWeek);
        uint256 tokenId = bound(tokenSeed, 0, ghostSupply);
        uint256 expected;
        if (ghostFinalized[week] && tokenId != 0) {
            uint256[10] memory top = board.leaders(week);
            for (uint256 i; i < 10; ++i) {
                if (top[i] == tokenId) {
                    expected = i == 0 ? 300 : (i < 3 ? 150 : 50);
                    break;
                }
            }
        }
        assertEq(board.prize(week, tokenId), expected, "prize tier");
        if (expected == 0 || board.prizeClaimed(week, tokenId)) {
            vm.expectRevert(SeasonBoard.NoPrize.selector);
            board.claimPrize(week, tokenId);
            return;
        }
        (,, address beneficiary) = board.entries(week, tokenId);
        assertTrue(beneficiary != address(0), "prize without a beneficiary");
        vm.prank(_actor(tokenSeed >> 8)); // Claims are permissionless; the caller gains nothing.
        board.claimPrize(week, tokenId);
        _award(beneficiary, expected);
        ghostPrizePaid[week] += expected;
        ++prizesClaimed;
    }

    // ---------------------------------------------------------------- helpers

    function _award(address account, uint256 amount) internal {
        ghostPoints[account] += amount;
        ghostTotalPoints += amount;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % ACTORS];
    }

    function _token(uint256 seed) internal view returns (uint256) {
        return bound(seed, 1, ghostSupply);
    }

    function _trackWeek() internal {
        uint256 week = (currentTime - genesis) / 1 weeks;
        if (week > maxWeek) maxWeek = week;
    }

    function _table(uint256 week, uint256 tokenId) internal view returns (bytes32) {
        (uint256 trainWork, uint256 raceDistance, address beneficiary) = board.entries(week, tokenId);
        return keccak256(abi.encode(board.leaders(week), trainWork, raceDistance, beneficiary));
    }

    function _band(uint256 stamina) internal pure returns (uint256) {
        return (stamina >= 10_000 ? 9_999 : stamina) / 2000;
    }

    function _overLimit(uint256 week, uint256 tokenId, address account) internal view returns (bool) {
        return matches.matchesPlayed(week, tokenId) >= 5 || matches.walletMatchesPlayed(week, account) >= 5;
    }

    function _cooling(uint256 first, uint256 second, address firstOwner, address secondOwner)
        internal
        view
        returns (bool)
    {
        uint256 last = matches.pairLastPlayed(_pair(first, second));
        uint256 walletLast =
            matches.walletPairLastPlayed(_pair(uint256(uint160(firstOwner)), uint256(uint160(secondOwner))));
        return
            (last != 0 && currentTime < last + 1 days)
                || (walletLast != 0 && currentTime < walletLast + 1 days);
    }

    function _pair(uint256 a, uint256 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _checkStaminaMonotonic() internal {
        for (uint256 t = 1; t <= ghostSupply; ++t) {
            uint256 s = nft.stamina(t);
            assertGe(s, lastStamina[t], "Stamina decreased");
            lastStamina[t] = s;
        }
    }
}
