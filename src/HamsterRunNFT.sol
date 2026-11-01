// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {GameAdmin} from "./lib/GameAdmin.sol";
import {GameMath} from "./lib/GameMath.sol";

contract HamsterRunNFT is ERC721, GameAdmin, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_STAMINA = 10_000;
    uint256 public totalSupply;
    address public trainBook;
    address public matchBook;
    bool public mintOpen;
    mapping(address => bool) public publicMinted;
    mapping(uint256 => uint256) public stamina;
    mapping(uint256 => bool) public matchLocked;

    error MintClosed();
    error MintLimit();
    error InvalidQuantity();
    error InMatch();

    event BooksConfigured(address indexed trainBook, address indexed matchBook);
    event MintOpenChanged(bool open);
    event StaminaChanged(uint256 indexed tokenId, uint256 previous, uint256 current, uint8 reason);
    event MatchLockChanged(uint256 indexed tokenId, bool locked);

    constructor(address owner_) ERC721("Hamster run", "HAM") GameAdmin(owner_) {}

    function configureBooks(address train_, address match_) external onlyOwner {
        if (trainBook != address(0)) revert AlreadyConfigured();
        _requireContract(train_);
        _requireContract(match_);
        if (train_ == match_) revert InvalidAddress();
        trainBook = train_;
        matchBook = match_;
        emit BooksConfigured(train_, match_);
    }

    function setMintOpen(bool open) external onlyOwner {
        if (open && trainBook == address(0)) revert NotConfigured();
        mintOpen = open;
        emit MintOpenChanged(open);
    }

    function mint() external nonReentrant returns (uint256 tokenId) {
        if (!mintOpen) revert MintClosed();
        if (publicMinted[msg.sender]) revert MintLimit();
        publicMinted[msg.sender] = true;
        tokenId = _mintOne(msg.sender);
    }

    function ownerMint(address to, uint256 quantity) external nonReentrant onlyOwner {
        if (quantity == 0 || quantity > 50) revert InvalidQuantity();
        if (totalSupply + quantity > MAX_SUPPLY) revert MintLimit();
        for (uint256 i; i < quantity; ++i) {
            _mintOne(to);
        }
    }

    function _mintOne(address to) internal returns (uint256 tokenId) {
        if (totalSupply == MAX_SUPPLY) revert MintLimit();
        tokenId = ++totalSupply;
        _safeMint(to, tokenId);
    }

    function applyTraining(uint256 tokenId, uint64 work) external returns (uint256 gain) {
        if (msg.sender != trainBook) revert Unauthorized();
        _requireOwned(tokenId);
        uint256 old = stamina[tokenId];
        gain = GameMath.trainGain(work, old);
        stamina[tokenId] = old + gain;
        emit StaminaChanged(tokenId, old, old + gain, 1);
    }

    function rewardWinner(uint256 tokenId) external {
        if (msg.sender != matchBook) revert Unauthorized();
        _requireOwned(tokenId);
        uint256 old = stamina[tokenId];
        uint256 next = old + 2;
        if (next > MAX_STAMINA) next = MAX_STAMINA;
        stamina[tokenId] = next;
        emit StaminaChanged(tokenId, old, next, 2);
    }

    function setMatchLock(uint256 tokenId, bool locked) external {
        if (msg.sender != matchBook) revert Unauthorized();
        _requireOwned(tokenId);
        matchLocked[tokenId] = locked;
        emit MatchLockChanged(tokenId, locked);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (matchLocked[tokenId]) revert InMatch();
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory json = string.concat(
            '{"name":"Hamster run #',
            Strings.toString(tokenId),
            '","description":"HamsterRun: independent Sepolia game demo. No SQK rewards or official mining rights.",',
            '"attributes":[{"trait_type":"Stamina","value":',
            Strings.toString(stamina[tokenId]),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
