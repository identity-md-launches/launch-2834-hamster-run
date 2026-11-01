import { BrowserProvider, JsonRpcProvider, FetchRequest, Contract, getAddress, keccak256 } from "./vendor/ethers-6.13.5.min.js";

const CHAIN_ID = 11155111n;
const CORE = "0x74665dAecA35A2303e767E76a2FF1FB6F93e119f";
const IMPLEMENTATION = "0x0a71C86ab63a77675002A389FDF4D096A07b11e2";
const RUNTIME_HASH = "0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d";
const NAMES = ["CoreReader", "HamsterRunNFT", "PointsLedger", "SeasonBoard", "TrainBook", "MatchBook"];
const $ = (id) => document.getElementById(id);
const rpcRequest = new FetchRequest("https://ethereum-sepolia-rpc.publicnode.com");
rpcRequest.timeout = 12_000;
const provider = new JsonRpcProvider(rpcRequest, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
const core = new Contract(CORE, [
  "function implementationCodeAddress() view returns (address)",
  "function implementationCodeVersion() view returns (uint64)",
  "function configuration() view returns ((bytes32 streamId,uint64 genesisTimestamp,uint64 roundDuration,uint64 maxWorkPerRound,uint16 maxRoundsPerBatch,address guardian,address reporter,uint32 initialWorkPerThousandBlocks,uint64 targetBlocksPerActiveRound,uint64 difficultySmoothingRounds,uint96 blockUnitsPerBlock))",
  "function state() view returns ((uint64 settledThroughRound,uint64 cumulativeWork,uint96 cumulativeBlockUnits,uint64 blockHeight,uint96 blockProgress,uint32 workPerThousandBlocks,uint256 authorizationNonce,bool paused))",
], provider);
let abis, addresses = {}, contracts = {}, signer, account, walletProvider;
let ready = false, sending = false, refreshing = false, calendar, snapshotBlock;
let latestRace;

function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function short(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function integer(id, minimum = 0n) {
  const value = $(id).value.trim();
  if (!/^\d+$/.test(value)) throw new Error("Enter a whole, non-negative number.");
  const number = BigInt(value);
  if (number < minimum || number > (1n << 64n) - 1n) throw new Error("Number is outside the supported range.");
  return number;
}
function writes() {
  document.querySelectorAll("[data-write]").forEach((button) => {
    button.disabled = !ready || !signer || sending;
  });
}
function readableError(error) {
  const data = error?.data ?? error?.info?.error?.data;
  let name;
  if (typeof data === "string") {
    for (const contract of Object.values(contracts)) {
      try { name = contract.interface.parseError(data)?.name; if (name) break; } catch { /* another ABI */ }
    }
  }
  const explanations = {
    UnknownRounds: "Core has not certified the whole window. This booking remains pending; retry later.",
    CorePaused: "Core is paused. Training remains pending; retry after it resumes.",
    CoreIdentityChanged: "Core's pinned identity changed. Training settlement is deferred for integration review; booking, racing and finalizing continue from the pinned genesis.",
    InvalidWindow: "Choose six future rounds entirely inside today's genesis-aligned day.",
    AlreadyBooked: "This NFT already booked a window today, including before a transfer.",
    NoPendingBooking: "There is no unsettled booking for that NFT and day.",
    NotTokenOwner: "This action requires the NFT owner, not an approved operator.",
    NotReady: "The race needs its future block hash and at least 15 elapsed seconds. Refresh and retry.",
    RandomnessExpired: "The block hash expired. Anyone can expire this race to release its NFTs.",
    CannotExpire: "This match is not eligible for expiry. A saved seed must be settled instead.",
    WeeklyLimit: "This NFT or wallet has used all five accepted matches for this week.",
    Cooldown: "This NFT pair or wallet pair must wait one day before another race.",
    BandMismatch: "These NFTs are in different Stamina bands (2,000 Stamina per band).",
    TokenBusy: "One of these NFTs is already in a challenge or race.",
    InMatch: "The NFT is locked while its challenge or race is active.",
    SeasonNotReady: "The week must end, its accepted races must resolve, and its booked trains must settle (or two weeks must pass since the week end).",
    NoPrize: "This NFT has no unclaimed finalized prize in that week.",
    MintLimit: "This wallet has already publicly minted, or the 10,000 supply cap was reached.",
    MintClosed: "Public minting is closed. The owner may provide a demo NFT.",
    ChallengeExpired: "This offer's hour or week has ended. Cancel or expire it.",
    WrongState: "That match action is not available in its current state.",
  };
  return explanations[name] ?? error?.shortMessage ?? error?.reason ?? error?.message ?? "The request failed. Refresh and retry.";
}
function on(id, fn) {
  $(id).addEventListener("click", async () => {
    try { await fn(); } catch (error) { message(readableError(error), true); }
  });
}

async function readCore() {
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error("Read provider is not on Sepolia.");
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("No chain snapshot is available.");
  const at = { blockTag: block.number };
  const [config, state, version, implementation, code] = await Promise.all([
    core.configuration(at), core.state(at), core.implementationCodeVersion(at),
    core.implementationCodeAddress(at), provider.getCode(IMPLEMENTATION, block.number),
  ]);
  if (version !== 3n || implementation !== IMPLEMENTATION || keccak256(code) !== RUNTIME_HASH || config.roundDuration !== 600n) {
    throw new Error("Core identity differs from the pinned V3 deployment. Integration review is needed.");
  }
  const elapsed = BigInt(block.timestamp) - config.genesisTimestamp;
  if (elapsed < 0n) throw new Error("Core genesis has not started.");
  const round = elapsed / 600n + 1n;
  if (state.settledThroughRound >= round) throw new Error("Core returned an impossible certification frontier.");
  const lag = round - 1n - state.settledThroughRound;
  calendar = { round, day: elapsed / 86400n, week: elapsed / 604800n, frontier: state.settledThroughRound, paused: state.paused };
  snapshotBlock = block.number;
  $("core-banner").className = `banner${state.paused ? " error" : lag === 0n ? " good" : ""}`;
  $("core-banner").textContent = `${state.paused ? "Core paused · training deferred" : lag ? "Core certification delayed" : "Core is caught up"}. Certified through round ${state.settledThroughRound}; current round ${round}. ${lag} closed rounds remain UNKNOWN. Uncertified work is never counted as zero.`;
  $("calendar").textContent = `Day ${calendar.day} · W${calendar.week}`;
  $("snapshot").textContent = `Sepolia block ${block.number} · days start at Core genesis`;
  if (!$("train-day").value) $("train-day").value = calendar.day.toString();
  if (!$("board-week").value) $("board-week").value = calendar.week.toString();
  if (!$("start-round").value) $("start-round").value = (round + 1n).toString();
  const last = (calendar.day + 1n) * 144n - 5n;
  $("window-hint").textContent = round + 1n <= last
    ? `Valid first rounds now: ${round + 1n}–${last}. All six rounds must finish within day ${calendar.day}.`
    : "No full future window fits today. Booking opens again at the next Core day.";
}

async function verifyDeployment(map) {
  ready = false; writes();
  const normalized = {};
  for (const name of NAMES) {
    if (!map?.[name] || !/^0x[0-9a-fA-F]{40}$/.test(map[name])) throw new Error(`Missing confirmed address: ${name}.`);
    normalized[name] = getAddress(map[name]);
    if (BigInt(normalized[name]) === 0n) throw new Error("A zero address is not a deployment.");
  }
  if (new Set(Object.values(normalized)).size !== NAMES.length) throw new Error("Each contract needs a distinct deployment address.");
  await readCore();
  const at = { blockTag: snapshotBlock };
  const result = {};
  await Promise.all(NAMES.map(async (name) => {
    if (await provider.getCode(normalized[name], snapshotBlock) === "0x") throw new Error(`${name} has no code on Sepolia.`);
    result[name] = new Contract(normalized[name], abis[name], provider);
  }));
  const links = [
    ["CoreReader", "core", CORE], ["CoreReader", "expectedImplementation", IMPLEMENTATION],
    ["CoreReader", "expectedRuntimeHash", RUNTIME_HASH],
    ["HamsterRunNFT", "trainBook", normalized.TrainBook], ["HamsterRunNFT", "matchBook", normalized.MatchBook],
    ["PointsLedger", "matchBook", normalized.MatchBook], ["PointsLedger", "seasonBoard", normalized.SeasonBoard],
    ["SeasonBoard", "trainBook", normalized.TrainBook], ["SeasonBoard", "matchBook", normalized.MatchBook],
    ["SeasonBoard", "nft", normalized.HamsterRunNFT], ["SeasonBoard", "ledger", normalized.PointsLedger], ["SeasonBoard", "reader", normalized.CoreReader],
    ["TrainBook", "nft", normalized.HamsterRunNFT], ["TrainBook", "reader", normalized.CoreReader], ["TrainBook", "board", normalized.SeasonBoard],
    ["MatchBook", "nft", normalized.HamsterRunNFT], ["MatchBook", "ledger", normalized.PointsLedger],
    ["MatchBook", "board", normalized.SeasonBoard], ["MatchBook", "reader", normalized.CoreReader],
  ];
  await Promise.all(links.map(async ([name, method, expected]) => {
    const actual = await result[name][method](at);
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${name}.${method} does not match the confirmed graph. Owner configuration may be incomplete.`);
  }));
  if (await result.HamsterRunNFT.name(at) !== "Hamster run" || await result.HamsterRunNFT.symbol(at) !== "HAM") {
    throw new Error("Collection identity does not match HamsterRun.");
  }
  addresses = normalized; contracts = result; ready = true;
  $("addresses").value = JSON.stringify(addresses, null, 2);
  $("contract-links").replaceChildren();
  for (const [name, address] of Object.entries(addresses)) {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = `https://sepolia.etherscan.io/address/${address}`; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.textContent = `${name}: ${address}`; li.append(a); $("contract-links").append(li);
  }
  $("deployment-status").textContent = "Six contracts connected · Sepolia · addresses checked against on-chain links";
  writes();
  await refresh();
}

async function readToken() {
  if (!ready) return;
  const token = integer("token-id", 1n), day = integer("train-day");
  const at = { blockTag: snapshotBlock };
  const [owner, stamina, booking, count] = await Promise.all([
    contracts.HamsterRunNFT.ownerOf(token, at), contracts.HamsterRunNFT.stamina(token, at),
    contracts.TrainBook.bookings(token, day, at), contracts.MatchBook.matchesPlayed(calendar.week, token, at),
  ]);
  $("stamina").textContent = stamina.toString();
  $("token-owner").textContent = `NFT #${token} · ${short(owner)} · band ${(stamina >= 10_000n ? 9999n : stamina) / 2000n}`;
  const walletCount = account ? await contracts.MatchBook.walletMatchesPlayed(calendar.week, account, at) : null;
  $("quota").textContent = `Week ${calendar.week}: NFT ${count}/5 accepted races${walletCount !== null ? ` · wallet ${walletCount}/5` : ""}. Rematch cooldown: one day.`;
  let text;
  if (booking.startRound === 0n) text = `Day ${day}: no window booked. No training is credited for a missed day.`;
  else if (booking.settled) text = `Day ${day}: settled rounds ${booking.startRound}–${booking.startRound + 5n}. Certified trainWork: ${booking.trainWork}.`;
  else if (calendar.paused) text = `Day ${day}: rounds ${booking.startRound}–${booking.startRound + 5n} pending. Core is paused; retry later.`;
  else if (booking.startRound + 5n > calendar.frontier) text = `Day ${day}: rounds ${booking.startRound}–${booking.startRound + 5n} pending. Work is UNKNOWN until the frontier reaches the end.`;
  else text = `Day ${day}: rounds ${booking.startRound}–${booking.startRound + 5n} are certified and ready to settle.`;
  $("booking-status").textContent = text;
}

async function readMatch() {
  if (!ready) return;
  const id = integer("match-id", 1n);
  const race = await contracts.MatchBook.races(id, { blockTag: snapshotBlock });
  latestRace = race;
  const states = ["Not found", "Offered", "Running", "Settled", "Cancelled", "Expired"];
  let text = `Match #${id}: ${states[Number(race.state)]}.`;
  if (race.state !== 0n) text += ` NFT #${race.first} vs #${race.second}, week ${race.week}.`;
  if (race.state === 1n) text += ` Only ${short(race.secondOwner)} can accept. Offer expires after one hour or at week end.`;
  if (race.state === 2n) text += ` Randomness block: ${race.randomBlock}; current block: ${snapshotBlock}. Earliest settlement: ${new Date(Number(race.readyAt) * 1000).toISOString()}. ${BigInt(race.seed) !== 0n ? "Seed saved." : "Seed not yet saved."}`;
  if (race.state === 3n) text += ` Distances: ${race.firstDistance} / ${race.secondDistance} game units. Winner: #${race.winner}.`;
  if (race.state === 5n) text += " No result or points; accepted-race quota remains consumed.";
  $("race-status").textContent = text;
  $("replay").disabled = race.state !== 3n;
}

async function readBoard() {
  if (!ready) return;
  const week = integer("board-week"), at = { blockTag: snapshotBlock };
  const board = contracts.SeasonBoard;
  const [top, finalized, trains, races] = await Promise.all([
    board.leaders(week, at), board.finalized(week, at), board.pendingTrains(week, at), board.pendingMatches(week, at),
  ]);
  $("board-status").textContent = `Week ${week} · ${finalized ? "FINALIZED" : "OPEN / PROVISIONAL"} · ${trains} ${finalized ? "uncertified trains excluded from this table (they still train their NFTs)" : "pending trains"} · ${races} pending races. Scores stay in their original week even when Core is late.`;
  const records = await Promise.all(top.filter((id) => id !== 0n).map(async (id, index) => {
    const [entry, score, claimed] = await Promise.all([board.entries(week, id, at), board.score(week, id, at), board.prizeClaimed(week, id, at)]);
    return [index + 1, `#${id}`, entry.trainWork, entry.raceDistance, score,
      `${index === 0 ? 300 : index < 3 ? 150 : 50}${claimed ? " · claimed" : finalized ? " · claimable" : " · provisional"}`];
  }));
  $("board-body").replaceChildren();
  for (const record of records) {
    const tr = document.createElement("tr");
    for (const value of record) { const td = document.createElement("td"); td.textContent = String(value); tr.append(td); }
    $("board-body").append(tr);
  }
  if (!records.length) {
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 6; td.textContent = "No scored NFTs in this week yet."; tr.append(td); $("board-body").append(tr);
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await readCore();
    if (ready) {
      const at = { blockTag: snapshotBlock };
      const [supply, points] = await Promise.all([
        contracts.HamsterRunNFT.totalSupply(at), account ? contracts.PointsLedger.points(account, at) : Promise.resolve(null),
      ]);
      $("supply").textContent = `${supply} / 10,000`;
      $("points").textContent = points === null ? "—" : points.toString();
      const sections = await Promise.allSettled([readToken(), readMatch(), readBoard()]);
      if (sections[0].status === "rejected") {
        $("stamina").textContent = "—"; $("token-owner").textContent = "NFT read unavailable";
        $("booking-status").textContent = readableError(sections[0].reason);
      }
      if (sections[1].status === "rejected") $("race-status").textContent = readableError(sections[1].reason);
      if (sections[2].status === "rejected") {
        $("board-status").textContent = `Board unavailable: ${readableError(sections[2].reason)}`;
        $("board-body").replaceChildren();
      }
    }
  } catch (error) {
    $("core-banner").className = "banner error";
    $("core-banner").textContent = `Core read unavailable. Work is UNKNOWN. ${readableError(error)}`;
    $("snapshot").textContent = "Read failed · any displayed values are from the last successful snapshot";
    throw error;
  } finally { refreshing = false; }
}

async function send(name, method, args, afterReceipt) {
  if (!ready || !signer) throw new Error("Load the confirmed deployment and connect a Sepolia wallet first.");
  if (sending) return;
  sending = true; writes();
  try {
    if (BigInt(await window.ethereum.request({ method: "eth_chainId" })) !== CHAIN_ID) throw new Error("Switch the wallet to Sepolia.");
    const current = await window.ethereum.request({ method: "eth_accounts" });
    if (!current.length || getAddress(current[0]) !== account) throw new Error("Wallet account changed. Reconnect before sending.");
    const contract = contracts[name].connect(signer);
    message("Checking this transaction against current chain state…");
    await contract[method].staticCall(...args);
    message("Confirm the transaction in your wallet. Only Sepolia gas is required.");
    const tx = await contract[method](...args);
    const link = document.createElement("a"); link.href = `https://sepolia.etherscan.io/tx/${tx.hash}`;
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "View transaction ↗";
    message("Submitted; waiting for one confirmation. "); $("message").append(link);
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("Transaction did not succeed.");
    if (afterReceipt) afterReceipt(receipt, contract);
    message(`Confirmed in block ${receipt.blockNumber}. `); $("message").append(link);
    try { await refresh(); }
    catch (error) { message(`Confirmed in block ${receipt.blockNumber}. The follow-up read failed: ${readableError(error)} `, true); $("message").append(link); }
  } finally { sending = false; writes(); }
}

on("connect", async () => {
  if (!window.ethereum) throw new Error("Install an EIP-1193 wallet to send transactions. Public Core reads work without one.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  if (BigInt(await window.ethereum.request({ method: "eth_chainId" })) !== CHAIN_ID) {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  }
  walletProvider = new BrowserProvider(window.ethereum);
  signer = await walletProvider.getSigner(); account = getAddress(await signer.getAddress());
  $("connect").textContent = short(account); writes();
  message("Wallet connected to Sepolia. All game transactions require your wallet confirmation.");
  await refresh();
});
on("refresh", refresh);
on("load-deployment", async () => {
  const input = JSON.parse($("addresses").value);
  await verifyDeployment(input.contracts ?? input);
  message("Deployment links verified. Compare the listed addresses with the network launch receipt before signing.");
});
on("load-token", async () => { await readCore(); await readToken(); });
on("load-match", async () => { await readCore(); await readMatch(); });
on("load-board", async () => { await readCore(); await readBoard(); });
on("mint", () => send("HamsterRunNFT", "mint", [], (receipt, contract) => {
  for (const log of receipt.logs) {
    try { const parsed = contract.interface.parseLog(log); if (parsed?.name === "Transfer") $("token-id").value = parsed.args.tokenId.toString(); } catch { /* another log */ }
  }
}));
on("book", () => send("TrainBook", "book", [integer("token-id", 1n), integer("start-round", 1n)]));
on("settle-train", () => send("TrainBook", "settle", [integer("token-id", 1n), integer("train-day")]));
on("challenge", () => send("MatchBook", "challenge", [integer("token-id", 1n), integer("opponent-id", 1n)], (receipt, contract) => {
  for (const log of receipt.logs) {
    try { const parsed = contract.interface.parseLog(log); if (parsed?.name === "Challenged") $("match-id").value = parsed.args.matchId.toString(); } catch { /* another log */ }
  }
}));
for (const [id, method] of [["accept", "accept"], ["settle-match", "settle"], ["capture", "captureRandomness"], ["cancel", "cancel"], ["expire", "expire"]]) {
  on(id, () => send("MatchBook", method, [integer("match-id", 1n)]));
}
on("finalize", () => send("SeasonBoard", "finalize", [integer("board-week")]));
on("claim-prize", () => send("SeasonBoard", "claimPrize", [integer("board-week"), integer("token-id", 1n)]));
on("replay", () => {
  if (latestRace?.state !== 3n) return;
  const course = $("race-course"); course.classList.remove("playing");
  course.style.setProperty("--a", `${Number(latestRace.firstDistance) / 22000 * 90}%`);
  course.style.setProperty("--b", `${Number(latestRace.secondDistance) / 22000 * 90}%`);
  void course.offsetWidth; course.classList.add("playing");
});
if (window.ethereum?.on) {
  const resetWallet = () => {
    signer = undefined; account = undefined; $("points").textContent = "—";
    $("connect").textContent = "Reconnect wallet"; writes();
    message("Wallet account or network changed. Reconnect to continue.");
  };
  window.ethereum.on("accountsChanged", resetWallet);
  window.ethereum.on("chainChanged", resetWallet);
}

try {
  const response = await fetch("./abis.json");
  if (!response.ok) throw new Error("Application ABIs could not be loaded.");
  abis = await response.json();
  const deploymentResponse = await fetch("./deployment.json");
  if (!deploymentResponse.ok) throw new Error("Deployment configuration could not be loaded.");
  const deployment = await deploymentResponse.json();
  if (deployment.chainId !== Number(CHAIN_ID)) throw new Error("Deployment configuration must name Sepolia.");
  if (NAMES.every((name) => deployment.contracts?.[name])) await verifyDeployment(deployment.contracts);
  else await refresh();
} catch (error) { message(readableError(error), true); }
setInterval(() => { if (!document.hidden && !sending) refresh().catch(() => {}); }, 15_000);
