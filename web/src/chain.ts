import { createConfig, fallback, http } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import {
  createPublicClient,
  decodeErrorResult,
  defineChain,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { deployment } from "./deployment-runtime";
import contractAbis from "./abis.json";

export const chain = defineChain({
  id: deployment.chainId,
  name: deployment.network.name,
  testnet: deployment.network.testnet,
  nativeCurrency: deployment.network.nativeCurrency,
  rpcUrls: { default: { http: deployment.network.rpcUrls } },
  blockExplorers: {
    default: { name: "Etherscan", url: deployment.network.explorer },
  },
});
const transport = () =>
  fallback(
    deployment.rpcUrls.map((url) =>
      http(url, {
        timeout: 9_000,
        retryCount: 0,
        batch: { batchSize: 40, wait: 12 },
      }),
    ),
    { retryCount: 0 },
  );
export const walletConfig = createConfig({
  chains: [chain],
  multiInjectedProviderDiscovery: true,
  connectors: [
    injected(),
    coinbaseWallet({ appName: "HamsterRun", preference: { options: "all" } }),
  ],
  transports: { [chain.id]: transport() },
});
export const client = createPublicClient({ chain, transport: transport() });
export const addresses = deployment.contracts as Record<ContractName, Address>;
export const explorer = deployment.explorer;
export type ContractName = keyof typeof contractAbis;
export const abi = (name: ContractName) => contractAbis[name] as Abi;
export const read = <T>(
  name: ContractName,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<T> =>
  client.readContract({
    address: addresses[name],
    abi: abi(name),
    functionName,
    args,
    blockNumber,
  }) as Promise<T>;

export type Core = {
  current: bigint;
  frontier: bigint;
  paused: boolean;
  lag: bigint;
  day: bigint;
  week: bigint;
  block: bigint;
  timestamp: bigint;
  genesis: bigint;
  identity: boolean;
};
export type Snapshot = {
  core: Core | null;
  coreError: string;
  genesisPinned: bigint | null;
  supply: bigint | null;
  mintOpen: boolean | null;
  mintError: string;
  wired: boolean;
  wiringError: string;
  block: bigint;
  timestamp: bigint;
  checkedAt: number;
};
export type Pet = { id: bigint; stamina: bigint; locked: boolean };
export type Rival = Pet & { owner: Address };
export type MatchEntry = { id: bigint; race: Race };
export type WalletData = { pets: Pet[]; points: bigint; publicMinted: boolean };
export type Booking = {
  day: bigint;
  start: bigint;
  settled: boolean;
  work: bigint | null;
};
export type BoardEntry = {
  id: bigint;
  trainWork: bigint;
  raceDistance: bigint;
  score: bigint;
};
export type Board = {
  week: bigint;
  entries: BoardEntry[];
  finalized: boolean;
  trains: bigint;
  matches: bigint;
};
export type Race = {
  first: bigint;
  second: bigint;
  firstOwner: Address;
  secondOwner: Address;
  week: bigint;
  offeredAt: bigint;
  readyAt: bigint;
  randomBlock: bigint;
  firstStamina: bigint;
  secondStamina: bigint;
  seed: `0x${string}`;
  firstDistance: bigint;
  secondDistance: bigint;
  winner: bigint;
  state: number;
};

let codeVerified = false;
export async function snapshot(): Promise<Snapshot> {
  if ((await client.getChainId()) !== chain.id)
    throw new Error("The read provider is not on Sepolia. Try refreshing.");
  const block = await client.getBlock();
  if (!codeVerified) {
    const codes = await Promise.all(
      Object.values(addresses).map((address) =>
        client.getCode({ address, blockNumber: block.number }),
      ),
    );
    if (codes.some((code) => !code || code === "0x"))
      throw new Error(
        "A game contract has no code on Sepolia. Transactions are disabled.",
      );
    codeVerified = true;
  }
  // Mint, game wiring and Core are independent reads. A failed subsystem must
  // never turn successfully read mint values into "unknown".
  const mint = await Promise.allSettled([
    read<bigint>("HamsterRunNFT", "totalSupply", [], block.number),
    read<boolean>("HamsterRunNFT", "mintOpen", [], block.number),
  ]);
  const supply = mint[0].status === "fulfilled" ? mint[0].value : null;
  const mintOpen = mint[1].status === "fulfilled" ? mint[1].value : null;
  const mintError = mint.some((r) => r.status === "rejected")
    ? "Mint reads failed. Refresh to check availability."
    : "";
  let wired = false,
    wiringError = "";
  try {
    const [train, match, ledgerMatch, ledgerBoard, boardTrain, boardMatch] =
      await Promise.all([
        read<Address>("HamsterRunNFT", "trainBook", [], block.number),
        read<Address>("HamsterRunNFT", "matchBook", [], block.number),
        read<Address>("PointsLedger", "matchBook", [], block.number),
        read<Address>("PointsLedger", "seasonBoard", [], block.number),
        read<Address>("SeasonBoard", "trainBook", [], block.number),
        read<Address>("SeasonBoard", "matchBook", [], block.number),
      ]);
    const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    wired =
      equal(train, addresses.TrainBook) &&
      equal(match, addresses.MatchBook) &&
      equal(ledgerMatch, addresses.MatchBook) &&
      equal(ledgerBoard, addresses.SeasonBoard) &&
      equal(boardTrain, addresses.TrainBook) &&
      equal(boardMatch, addresses.MatchBook);
  } catch {
    wiringError = "Game wiring could not be checked. Refresh before playing.";
  }
  let genesisPinned: bigint | null = null;
  try {
    genesisPinned = await read<bigint>(
      "CoreReader",
      "genesisTimestamp",
      [],
      block.number,
    );
  } catch {
    /* The pin CTA stays unavailable when its state is unknown. */
  }
  let core: Core | null = null,
    coreError = "";
  try {
    const [status, clock, genesis] = await Promise.all([
      read<readonly [bigint, bigint, boolean, bigint]>(
        "CoreReader",
        "status",
        [],
        block.number,
      ),
      read<readonly [bigint, bigint, bigint]>(
        "CoreReader",
        "clock",
        [],
        block.number,
      ),
      read<bigint>("CoreReader", "genesis", [], block.number),
    ]);
    // configuration() performs the adapter's pinned implementation/codehash checks.
    let identity = true;
    try {
      await read("CoreReader", "configuration", [], block.number);
    } catch {
      identity = false;
    }
    core = {
      current: status[0],
      frontier: status[1],
      paused: status[2],
      lag: status[3],
      day: clock[1],
      week: clock[2],
      block: block.number,
      timestamp: block.timestamp,
      genesis,
      identity,
    };
  } catch (error) {
    coreError = readableError(error);
  }
  return {
    core,
    coreError,
    genesisPinned,
    supply,
    mintOpen,
    mintError,
    wired,
    wiringError,
    block: block.number,
    timestamp: block.timestamp,
    checkedAt: Date.now(),
  };
}

export async function walletData(
  address: Address,
  supply: bigint,
  block: bigint,
): Promise<WalletData> {
  const [points, publicMinted, balance] = await Promise.all([
    read<bigint>("PointsLedger", "points", [address], block),
    read<boolean>("HamsterRunNFT", "publicMinted", [address], block),
    read<bigint>("HamsterRunNFT", "balanceOf", [address], block),
  ]);
  const ids: bigint[] = [];
  // ERC721 is not enumerable. Scan all minted IDs in bounded, multicall-free batches.
  // At most 10,000; no deployment-block log-range assumptions or stale local ownership caches.
  if (balance > 0n) {
    for (
      let start = 1n;
      start <= supply && BigInt(ids.length) < balance;
      start += 80n
    ) {
      const end = start + 80n > supply + 1n ? supply + 1n : start + 80n;
      const batch = Array.from(
        { length: Number(end - start) },
        (_, i) => start + BigInt(i),
      );
      const results = await Promise.all(
        batch.map((id) =>
          read<Address>("HamsterRunNFT", "ownerOf", [id], block),
        ),
      );
      results.forEach((owner, i) => {
        if (String(owner).toLowerCase() === address.toLowerCase())
          ids.push(batch[i]);
      });
    }
    if (BigInt(ids.length) !== balance)
      throw new Error(
        "Unable to finish checking owned HAMs. Refresh to retry.",
      );
  }
  const pets = await Promise.all(
    ids.map(async (id) => {
      const [stamina, locked] = await Promise.all([
        read<bigint>("HamsterRunNFT", "stamina", [id], block),
        read<boolean>("HamsterRunNFT", "matchLocked", [id], block),
      ]);
      return { id, stamina, locked };
    }),
  );
  return { pets, points, publicMinted };
}
/** Scan a bounded ID page at one block; no fabricated or cached ownership. */
export async function rivalsPage(
  selected: Pet,
  owner: Address,
  supply: bigint,
  block: bigint,
  start = 1n,
) {
  const through = start + 79n < supply ? start + 79n : supply;
  const ids = Array.from(
    { length: Math.max(0, Number(through - start + 1n)) },
    (_, i) => start + BigInt(i),
  );
  const rivals: Rival[] = [];
  // Bound concurrent RPC work. A failed page is an error, never an empty list.
  for (let i = 0; i < ids.length; i += 20) {
    const rows = await Promise.all(
      ids.slice(i, i + 20).map(async (id) => {
        if (id === selected.id) return null;
        const other = await read<Address>(
          "HamsterRunNFT",
          "ownerOf",
          [id],
          block,
        );
        if (other.toLowerCase() === owner.toLowerCase()) return null;
        const [stamina, locked] = await Promise.all([
          read<bigint>("HamsterRunNFT", "stamina", [id], block),
          read<boolean>("HamsterRunNFT", "matchLocked", [id], block),
        ]);
        const band = (s: bigint) => (s < 10000n ? s : 9999n) / 2000n;
        return !locked && band(stamina) === band(selected.stamina)
          ? { id, owner: other, stamina, locked }
          : null;
      }),
    );
    for (const row of rows) if (row) rivals.push(row);
  }
  return { rivals, through, next: through < supply ? through + 1n : undefined };
}

/** Newest-first scan of authoritative race structs, including both wallet roles. */
export async function inboxPage(
  owner: Address,
  block: bigint,
  before: bigint | null,
) {
  const end =
    before ?? (await read<bigint>("MatchBook", "nextMatchId", [], block));
  const start = end > 60n ? end - 60n : 1n;
  const matches: MatchEntry[] = [];
  for (let cursor = end - 1n; cursor >= start; cursor -= 20n) {
    const ids = Array.from(
      { length: Number(cursor - start + 1n < 20n ? cursor - start + 1n : 20n) },
      (_, i) => cursor - BigInt(i),
    );
    const races = await Promise.all(
      ids.map((id) => read<Race>("MatchBook", "races", [id], block)),
    );
    races.forEach((race, i) => {
      if (
        race.state === 1 &&
        [race.firstOwner, race.secondOwner].some(
          (a) => a.toLowerCase() === owner.toLowerCase(),
        )
      )
        matches.push({ id: ids[i], race });
    });
  }
  return {
    matches,
    next: start > 1n ? start : undefined,
    through: start,
    total: end - 1n,
  };
}

export async function booking(
  id: bigint,
  day: bigint,
  block?: bigint,
): Promise<Booking> {
  const [start, settled, work] = await read<readonly [bigint, boolean, bigint]>(
    "TrainBook",
    "bookings",
    [id, day],
    block,
  );
  return { day, start, settled, work: settled ? work : null };
}
export async function board(week: bigint, block?: bigint): Promise<Board> {
  const [ids, finalized, trains, matches] = await Promise.all([
    read<bigint[]>("SeasonBoard", "leaders", [week], block),
    read<boolean>("SeasonBoard", "finalized", [week], block),
    read<bigint>("SeasonBoard", "pendingTrains", [week], block),
    read<bigint>("SeasonBoard", "pendingMatches", [week], block),
  ]);
  const entries = await Promise.all(
    ids
      .filter((id) => id !== 0n)
      .map(async (id) => {
        const [trainWork, raceDistance] = await read<
          readonly [bigint, bigint, Address]
        >("SeasonBoard", "entries", [week, id], block);
        return {
          id,
          trainWork,
          raceDistance,
          score: trainWork + raceDistance / 100n,
        };
      }),
  );
  return { week, entries, finalized, trains, matches };
}
export function readableError(error: unknown): string {
  const names: Record<string, string> = {
    MintClosed:
      "Mint is closed. Try again after the collection owner opens minting.",
    MintLimit:
      "This wallet has already minted, or all 10,000 HAMs have been minted.",
    UnknownRounds:
      "Core has not certified this whole window. Your training stays pending; retry later.",
    CorePaused:
      "Core is paused. Training stays pending; retry after it resumes.",
    CoreIdentityChanged:
      "Core identity changed. Work settlement needs an integration review.",
    InvalidWindow:
      "Choose six future rounds entirely within the current Core day.",
    AlreadyBooked:
      "This HAM already has a window for that day. Choose another day to inspect it.",
    NoPendingBooking:
      "There is no unsettled booking for that HAM and day. Refresh its training.",
    NotTokenOwner: "Connect the wallet that owns this HAM.",
    NotReady:
      "The future block or 15-second minimum has not passed. Refresh and retry.",
    RandomnessExpired:
      "The race hash expired. Use Release expired race to unlock the HAMs.",
    CannotExpire:
      "This race cannot expire yet. A race with a saved seed must be settled.",
    BandMismatch: "Choose an opponent in the same 2,000-Stamina band.",
    TokenBusy: "One of these HAMs is in a challenge or race. Resolve it first.",
    InMatch:
      "This HAM is locked in a challenge or race. Resolve that race first.",
    InvalidOpponent: "Choose a HAM owned by another wallet.",
    WeeklyLimit:
      "This HAM or wallet has used its five accepted races this week.",
    Cooldown:
      "This pair of HAMs or wallets must wait 24 hours before racing again.",
    ChallengeExpired:
      "The offer expired after one hour or at week end. Release it and challenge again.",
    WrongState:
      "That action is unavailable for the current race state. Refresh the race.",
    SeasonNotReady:
      "The week must end and races must resolve. Pending trains also need settlement or the two-week grace.",
    SeasonClosed: "This week is already finalized. Choose a different week.",
    NoPrize: "This HAM has no unclaimed point tier for this finalized week.",
  };
  const e = error as {
    message?: string;
    shortMessage?: string;
    walk?: (fn: (e: { data?: { errorName?: string } }) => boolean) => {
      data?: { errorName?: string };
    };
    code?: number;
  };
  const custom = e?.walk?.((part) => Boolean(part.data?.errorName))?.data
    ?.errorName;
  if (custom && names[custom]) return names[custom];
  let part = error as { data?: unknown; cause?: unknown } | undefined;
  for (
    let depth = 0;
    depth < 8 && part;
    depth++, part = part.cause as typeof part
  ) {
    if (typeof part.data !== "string" || !/^0x[\da-f]+$/i.test(part.data))
      continue;
    for (const name of Object.keys(contractAbis) as ContractName[]) {
      try {
        const decoded = decodeErrorResult({
          abi: abi(name),
          data: part.data as Hex,
        });
        if (names[decoded.errorName]) return names[decoded.errorName];
      } catch {
        /* another contract's error */
      }
    }
  }
  const text =
    e?.shortMessage ||
    e?.message ||
    "Request unavailable. Check your connection and retry.";
  const detail = `${text}\n${e?.message || ""}`;
  for (const [name, message] of Object.entries(names))
    if (detail.includes(name)) return message;
  if (/reject|denied|4001/i.test(detail) || e?.code === 4001)
    return "Request declined in your wallet. You can try again.";
  if (/fetch|network|timed out|HTTP request/i.test(detail))
    return "Sepolia reads are unavailable. Check your connection and refresh.";
  return text.length > 260
    ? "The request failed. Refresh and try again; your wallet may have more details."
    : text;
}
