// Validation fixtures only. No fixture data or test wallet is part of the application bundle.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  hexToString,
  toHex,
  verifyMessage,
  zeroAddress,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createInviteServer } from "../service/server.mjs";

const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const playwright = await (option("--playwright")
  ? import(pathToFileURL(resolve(option("--playwright"))).href)
  : import("playwright"));
const axeModule = option("--axe")
  ? await import(pathToFileURL(resolve(option("--axe"))).href)
  : null;
const root = resolve(fileURLToPath(new URL("../../dist/", import.meta.url)));
const out = resolve(
  option("--out") ||
    fileURLToPath(new URL("../../test/scratch/interaction/", import.meta.url)),
);
await mkdir(out, { recursive: true });
const d = JSON.parse(
  await readFile(new URL("../src/deployment.json", import.meta.url), "utf8"),
);
const abis = JSON.parse(
  await readFile(new URL("../src/abis.json", import.meta.url), "utf8"),
);
const account = privateKeyToAccount(generatePrivateKey()),
  opponent = privateKeyToAccount(generatePrivateKey()),
  referrer = privateKeyToAccount(generatePrivateKey());
const accounts = [account, opponent];
const fixedHash = (byte) => `0x${byte.repeat(64)}`;
const genesis = 1791847800n;
const state = {
  current: 3000n,
  frontier: 2979n,
  paused: false,
  identity: true,
  mintOpen: true,
  wired: false,
  supply: 1n,
  minted: false,
  stamina: 0n,
  points: 0n,
  start: 0n,
  settled: false,
  trainWork: 0n,
  race: null,
  distance: 0n,
  block: 1000n,
  now: genesis + 2999n * 600n + 30n,
  rejectNext: false,
  failRead: false,
  failCore: false,
  failMint: false,
  failWiring: false,
  pinned: true,
  catalog: false,
  scanMode: false,
  nextMatchOverride: null,
};
const receipts = new Map(),
  txs = new Map();
let sends = 0;
function rpc(request) {
  const { method, params = [] } = request;
  if (state.failRead && method === "eth_chainId")
    throw new Error("Simulated read outage");
  if (method === "eth_chainId") return toHex(11155111);
  if (method === "eth_blockNumber") return toHex(state.block);
  if (method === "eth_getCode") return "0x6001600055";
  if (method === "eth_getBlockByNumber")
    return {
      number: toHex(state.block),
      hash: fixedHash("a"),
      parentHash: fixedHash("b"),
      timestamp: toHex(state.now),
      gasLimit: toHex(30000000),
      gasUsed: toHex(100000),
      baseFeePerGas: toHex(1000000000),
      transactions: [],
      logsBloom: `0x${"0".repeat(512)}`,
      nonce: "0x0000000000000000",
      extraData: "0x",
      miner: opponent.address,
    };
  if (method === "eth_getTransactionReceipt")
    return receipts.get(params[0]) || null;
  if (method === "eth_getTransactionByHash") return txs.get(params[0]) || null;
  if (method === "eth_getBalance") return toHex(10n ** 18n);
  if (method === "eth_getTransactionCount") return "0x1";
  if (method === "eth_estimateGas") return "0x186a0";
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
    return "0x3b9aca00";
  if (method === "eth_call") {
    const call = params[0];
    const name = Object.keys(d.contracts).find(
      (n) => d.contracts[n].toLowerCase() === call.to?.toLowerCase(),
    );
    if (!name) throw new Error(`Unexpected contract ${call.to}`);
    const decoded = decodeFunctionData({ abi: abis[name], data: call.data });
    const a = decoded.args || [],
      f = decoded.functionName;
    if (state.failCore && name === "CoreReader" && f !== "genesisTimestamp")
      throw new Error("Core read failed");
    if (
      state.failMint &&
      name === "HamsterRunNFT" &&
      ["totalSupply", "mintOpen"].includes(f)
    )
      throw new Error("Mint read failed");
    if (state.failWiring && name === "SeasonBoard" && f === "trainBook")
      throw new Error("Wiring read failed");
    let result;
    if (name === "HamsterRunNFT") {
      const values = {
        totalSupply: state.supply,
        mintOpen: state.mintOpen,
        trainBook: d.contracts.TrainBook,
        matchBook: d.contracts.MatchBook,
        publicMinted:
          state.minted &&
          String(a[0]).toLowerCase() === account.address.toLowerCase(),
        balanceOf:
          String(a[0]).toLowerCase() === opponent.address.toLowerCase()
            ? state.catalog
              ? 5n
              : 1n
            : state.minted
              ? state.catalog
                ? 2n
                : 1n
              : 0n,
        stamina:
          BigInt(a[0] || 0) === 2n
            ? state.stamina
            : state.scanMode
              ? BigInt(a[0] || 0) === 81n
                ? 0n
                : 2000n
              : ({ 4: 2000n, 6: 10000n, 7: 9999n }[Number(a[0])] ?? 0n),
        matchLocked:
          (state.catalog && BigInt(a[0] || 0) === 5n) ||
          Boolean(
            state.race &&
              (([1, 2].includes(state.race.state) &&
                BigInt(a[0] || 0) === 2n) ||
                (state.race.state === 2 && BigInt(a[0] || 0) === 1n)),
          ),
      };
      if (f === "ownerOf")
        result =
          BigInt(a[0]) === 2n || (state.catalog && BigInt(a[0]) === 3n)
            ? account.address
            : opponent.address;
      else if (f === "mint") {
        if (!state.mintOpen)
          throw {
            data: encodeErrorResult({
              abi: abis[name],
              errorName: "MintClosed",
            }),
          };
        if (state.minted)
          throw {
            data: encodeErrorResult({
              abi: abis[name],
              errorName: "MintLimit",
            }),
          };
        result = 2n;
      } else result = values[f];
    } else if (name === "PointsLedger")
      result = {
        matchBook: d.contracts.MatchBook,
        seasonBoard: d.contracts.SeasonBoard,
        points: state.points,
      }[f];
    else if (name === "CoreReader") {
      if (f === "status")
        result = [
          state.current,
          state.frontier,
          state.paused,
          state.current - 1n - state.frontier,
        ];
      if (f === "clock")
        result = [
          state.current,
          (state.current - 1n) / 144n,
          (state.current - 1n) / 1008n,
        ];
      if (f === "genesis") result = genesis;
      if (f === "genesisTimestamp") result = state.pinned ? genesis : 0n;
      if (f === "pinGenesis") result = genesis;
      if (f === "configuration") {
        if (!state.identity)
          throw {
            data: encodeErrorResult({
              abi: abis[name],
              errorName: "CoreIdentityChanged",
            }),
          };
        result = {
          streamId: fixedHash("a"),
          genesisTimestamp: genesis,
          roundDuration: 600n,
          maxWorkPerRound: 1000n,
          maxRoundsPerBatch: 100,
          guardian: opponent.address,
          reporter: opponent.address,
          initialWorkPerThousandBlocks: 100,
          targetBlocksPerActiveRound: 100n,
          difficultySmoothingRounds: 10n,
          blockUnitsPerBlock: 100n,
        };
      }
    } else if (name === "TrainBook") {
      if (f === "bookings")
        result = [
          state.start,
          state.settled,
          state.settled ? state.trainWork : 0n,
        ];
      if (f === "settle") {
        if (state.paused)
          throw {
            data: encodeErrorResult({
              abi: abis[name],
              errorName: "CorePaused",
            }),
          };
        if (state.start + 5n > state.frontier)
          throw {
            data: encodeErrorResult({
              abi: abis.CoreReader,
              errorName: "UnknownRounds",
              args: [state.start + 5n, state.frontier],
            }),
          };
        result = [123n, 10n];
      }
    } else if (name === "SeasonBoard") {
      if (f === "trainBook")
        result = state.wired ? d.contracts.TrainBook : zeroAddress;
      if (f === "matchBook")
        result = state.wired ? d.contracts.MatchBook : zeroAddress;
      if (f === "leaders")
        result = [
          ...(state.trainWork || state.distance ? [2n] : []),
          ...Array(state.trainWork || state.distance ? 9 : 10).fill(0n),
        ];
      if (f === "entries")
        result = [state.trainWork, state.distance, account.address];
      if (f === "finalized") result = false;
      if (f === "pendingTrains")
        result = state.start && !state.settled ? 1n : 0n;
      if (f === "pendingMatches") result = state.race?.state === 2 ? 1n : 0n;
    } else if (name === "MatchBook") {
      if (f === "nextMatchId")
        result = state.nextMatchOverride ?? (state.race ? 2n : 1n);
      if (f === "activeMatch")
        result =
          state.race &&
          (state.race.state === 2 ||
            (state.race.state === 1 && BigInt(a[0]) === 2n))
            ? 1n
            : 0n;
      if (f === "challenge") result = 1n;
      if (f === "captureRandomness") result = fixedHash("c");
      if (f === "races")
        result = (BigInt(a[0]) === 1n ? state.race : null) || {
          first: 0n,
          second: 0n,
          firstOwner: account.address,
          secondOwner: opponent.address,
          week: 0n,
          offeredAt: 0n,
          readyAt: 0n,
          randomBlock: 0n,
          firstStamina: 0n,
          secondStamina: 0n,
          seed: fixedHash("0"),
          firstDistance: 0n,
          secondDistance: 0n,
          winner: 0n,
          state: 0,
        };
    }
    return encodeFunctionResult({ abi: abis[name], functionName: f, result });
  }
  throw new Error(`Unhandled RPC ${method}`);
}
function transact(tx) {
  sends++;
  const name = Object.keys(d.contracts).find(
    (n) => d.contracts[n].toLowerCase() === tx.to.toLowerCase(),
  );
  const { functionName: f, args: a = [] } = decodeFunctionData({
    abi: abis[name],
    data: tx.data,
  });
  const hash = toHex(BigInt(sends), { size: 32 });
  state.block += 3n;
  state.now += 20n;
  const logs = [];
  const event = (eventName, args, data = "0x") =>
    logs.push({
      address: d.contracts[name],
      topics: encodeEventTopics({ abi: abis[name], eventName, args }),
      data,
      blockNumber: toHex(state.block - 1n),
      blockHash: fixedHash("a"),
      transactionHash: hash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
    });
  if (f === "mint") {
    state.minted = true;
    state.supply = 2n;
    event("Transfer", { from: zeroAddress, to: account.address, tokenId: 2n });
  }
  if (f === "pinGenesis") state.pinned = true;
  if (f === "book") state.start = a[1];
  if (name === "TrainBook" && f === "settle") {
    state.settled = true;
    state.trainWork = 123n;
    state.stamina = 10n;
  }
  if (f === "challenge") {
    state.race = {
      first: 2n,
      second: 1n,
      firstOwner: account.address,
      secondOwner: opponent.address,
      week: (state.current - 1n) / 1008n,
      offeredAt: state.now,
      readyAt: 0n,
      randomBlock: 0n,
      firstStamina: 10n,
      secondStamina: 0n,
      seed: fixedHash("0"),
      firstDistance: 0n,
      secondDistance: 0n,
      winner: 0n,
      state: 1,
    };
    event(
      "Challenged",
      { matchId: 1n, first: 2n, second: 1n },
      encodeAbiParameters([{ type: "uint256" }], [state.race.week]),
    );
  }
  if (f === "accept") {
    Object.assign(state.race, {
      state: 2,
      readyAt: state.now + 15n,
      randomBlock: state.block + 2n,
    });
  }
  if (f === "captureRandomness") state.race.seed = fixedHash("c");
  if (name === "MatchBook" && f === "settle") {
    Object.assign(state.race, {
      state: 3,
      firstDistance: 19999n,
      secondDistance: 15000n,
      winner: 2n,
    });
    state.distance = 19999n;
    state.points = 1n;
  }
  if (f === "cancel") state.race.state = 4;
  if (f === "expire") state.race.state = 5;
  const receipt = {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: fixedHash("a"),
    blockNumber: toHex(state.block - 1n),
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: "0x186a0",
    gasUsed: "0x186a0",
    effectiveGasPrice: "0x3b9aca00",
    logsBloom: `0x${"0".repeat(512)}`,
    logs,
    status: "0x1",
    type: "0x2",
    contractAddress: null,
  };
  receipts.set(hash, receipt);
  txs.set(hash, {
    ...tx,
    hash,
    blockHash: fixedHash("a"),
    blockNumber: toHex(state.block - 1n),
    transactionIndex: "0x0",
    value: "0x0",
    gas: "0x186a0",
    nonce: toHex(sends),
    type: "0x2",
    chainId: toHex(11155111),
  });
  return hash;
}
const api = createInviteServer({
  dbPath: ":memory:",
  verifier: {
    verifySignature: (address, message, signature) =>
      verifyMessage({ address, message, signature }),
    verifyMint: async (wallet, hash) => {
      assert.ok(receipts.has(hash));
      return { blockNumber: state.block, blockHash: fixedHash("a") };
    },
  },
});
const mimes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api")) {
    api.server.emit("request", req, res);
    return;
  }
  const pathname = new URL(req.url, "http://local").pathname;
  const relative = pathname.startsWith("/preview/")
    ? pathname.slice("/preview".length)
    : pathname;
  const file = resolve(
    root,
    "." + decodeURIComponent(relative),
    relative.endsWith("/") ? "index.html" : "",
  );
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.setHeader(
      "content-type",
      mimes[extname(file)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`,
  url = origin + "/preview/";
const challenge = await fetch(origin + "/api/challenge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet: referrer.address,
    action: "register",
    handle: "friend",
  }),
}).then((r) => r.json());
await fetch(origin + "/api/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    challengeId: challenge.id,
    signature: await referrer.signMessage({ message: challenge.message }),
  }),
});
let browser;
const result = { checks: [], live: null, axe: [], limitations: [] };
const check = (name) => {
  result.checks.push({ name, passed: true });
  console.log("PASS", name);
};
const wait = async (condition, message) => {
  for (let i = 0; i < 80; i++) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(message);
};
try {
  browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  await context.exposeBinding(
    "__testRequest",
    async (_source, { method, params }) => {
      if (method === "eth_sendTransaction") {
        if (state.rejectNext) {
          state.rejectNext = false;
          throw new Error("User rejected request.");
        }
        return transact(params[0]);
      }
      if (method === "personal_sign") {
        const signer = accounts.find(
          (a) => a.address.toLowerCase() === params[1].toLowerCase(),
        );
        return signer.signMessage({ message: hexToString(params[0]) });
      }
      return rpc({ method, params });
    },
  );
  await context.addInitScript(
    ({ address }) => {
      const listeners = {};
      const provider = {
        accounts: JSON.parse(
          localStorage.getItem("test:wallet-accounts") ||
            JSON.stringify([address]),
        ),
        chainId: "0xaa36a7",
        authorized: localStorage.getItem("test:wallet-authorized") === "1",
        request: async ({ method, params = [] }) => {
          if (method === "eth_accounts")
            return provider.authorized ? provider.accounts : [];
          if (method === "eth_requestAccounts") {
            provider.authorized = true;
            localStorage.setItem("test:wallet-authorized", "1");
            return provider.accounts;
          }
          if (method === "eth_chainId") return provider.chainId;
          if (
            ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(
              method,
            )
          ) {
            provider.chainId = "0xaa36a7";
            provider.emit("chainChanged", "0xaa36a7");
            return null;
          }
          return window.__testRequest({ method, params });
        },
        on: (event, fn) => {
          (listeners[event] ??= []).push(fn);
        },
        removeListener: (event, fn) => {
          listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
        },
        emit: (event, data) => {
          if (event === "accountsChanged")
            localStorage.setItem("test:wallet-accounts", JSON.stringify(data));
          (listeners[event] || []).forEach((fn) => fn(data));
        },
      };
      window.__testWallet = provider;
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "4efc6dd9-5c50-4412-9b2d-bdc87fc5ba58",
                name: "Validation wallet",
                rdns: "test.hamsterrun.wallet",
                icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Crect width='28' height='28' fill='%230055ff'/%3E%3C/svg%3E",
              },
              provider,
            },
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address },
  );
  let serviceMode = "offline";
  const routeHandler = async (route) => {
    const request = route.request();
    if (request.url().endsWith("/site-config.json")) {
      if (serviceMode === "configured")
        return route.fulfill({ json: { inviteServiceUrl: origin + "/api" } });
      return route.fulfill({ json: { inviteServiceUrl: "" } });
    }
    if (d.rpcUrls.some((r) => request.url().startsWith(r))) {
      const payload = request.postDataJSON();
      const handle = (item) => {
        try {
          return { jsonrpc: "2.0", id: item.id, result: rpc(item) };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: item.id,
            error: {
              code: -32000,
              message: e.message || "Contract reverted",
              data: e.data,
            },
          };
        }
      };
      return route.fulfill({
        json: Array.isArray(payload) ? payload.map(handle) : handle(payload),
      });
    }
    if (request.url().startsWith(origin) || request.url().startsWith("data:"))
      return route.continue();
    return route.abort();
  };
  await context.route("**/*", routeHandler);
  const page = await context.newPage(),
    errors = [],
    missing = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400)
      missing.push(`${r.status()} ${r.url()}`);
  });
  const refresh = async () => {
    state.block += 1n;
    const expected = state.block.toString();
    await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
    await wait(
      async () =>
        (await page
          .locator(".page[data-snapshot-block]")
          .getAttribute("data-snapshot-block")) === expected,
      "Snapshot did not advance",
    );
    await page
      .getByText("Loading race…", { exact: true })
      .waitFor({ state: "hidden" });
    await page
      .getByText("Checking owned HAMs and Stamina…", { exact: true })
      .waitFor({ state: "hidden" });
  };
  const switchAccount = async (address) => {
    await page.evaluate((address) => {
      window.__testWallet.accounts = [address];
      window.__testWallet.emit("accountsChanged", [address]);
    }, address);
  };
  await page.goto(url, { waitUntil: "load" });
  await page
    .locator(".mint-state")
    .getByText("Open", { exact: true })
    .waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  const mint = page.getByRole("button", { name: "Mint a hamster" });
  assert.ok(
    (await mint.boundingBox()).y + (await mint.boundingBox()).height < 844,
  );
  assert.equal(await page.locator(".network-label .good").count(), 1);
  await page.screenshot({ path: out + "/play-390.png" });
  check(
    "390 first screen: product, mint and rival shortcut visible; wallet closed until click",
  );
  await page.locator(".manual-challenge summary").click();
  await page
    .locator(".manual-challenge")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineWidth,
    ),
    "3px",
  );
  await page.screenshot({ path: out + "/wallet-focus.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  check(
    "Disconnected Challenge says Connect and opens sheet only on request; keyboard focus/Escape work",
  );
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Validation wallet" }).click();
  await page
    .getByText("No HAMs in this wallet yet.", { exact: false })
    .waitFor();
  await page.evaluate(() => {
    window.__testWallet.chainId = "0x1";
    window.__testWallet.emit("chainChanged", "0x1");
  });
  await page.getByRole("button", { name: "Switch to Sepolia" }).waitFor();
  assert.equal(await mint.isDisabled(), true);
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await wait(() => mint.isEnabled(), "Mint disabled after chain switch");
  state.rejectNext = true;
  await mint.click();
  await page
    .getByText("Request declined in your wallet. You can try again.")
    .waitFor();
  assert.equal(sends, 0);
  check(
    "Wrong chain blocks writes; chain switch and wallet rejection recover without a transaction",
  );
  state.pinned = false;
  await refresh();
  await page
    .getByRole("button", { name: "Pin genesis", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Pin genesis", exact: true }).click();
  await page.getByText("Core is catching up", { exact: true }).waitFor();
  assert.equal(state.pinned, true);
  assert.ok((await page.locator(".core-banner").innerText()).includes("2,979"));
  check(
    "Unpinned Core offers permissionless pinGenesis before wiring; pinned lag/frontier stay honest",
  );
  await mint.click();
  await page
    .getByRole("button", { name: "Your HAM is already minted" })
    .waitFor();
  await page.getByRole("button", { name: /HAM #2 Stamina/ }).waitFor();
  assert.equal(state.minted, true);
  assert.equal(
    await page.getByRole("button", { name: "Book training" }).isDisabled(),
    true,
  );
  check(
    "Open mint works independently of incomplete game wiring and loads owned HAM",
  );
  state.wired = true;
  await refresh();
  await page.locator("#start-round").fill("2999");
  await page
    .getByRole("button", { name: "Book training", exact: false })
    .click();
  await page.getByText("Choose a first round from", { exact: false }).waitFor();
  await page.locator("#start-round").fill("3002");
  await page
    .getByRole("button", { name: "Book training", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Waiting for certification", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".round").getByText("Unknown", { exact: true }).count(),
    6,
  );
  state.paused = true;
  await refresh();
  await page
    .getByRole("button", { name: "Core paused", exact: true })
    .waitFor();
  state.paused = false;
  state.current = 3012n;
  state.frontier = 3007n;
  state.now = genesis + 3011n * 600n + 30n;
  await refresh();
  await wait(
    () =>
      page
        .getByRole("button", { name: "Settle certified training", exact: true })
        .isEnabled(),
    "Certified training not ready",
  );
  await page
    .getByRole("button", { name: "Settle certified training", exact: true })
    .click();
  await page
    .getByText("Settled · 123 certified trainWork", { exact: false })
    .waitFor();
  check(
    "Training rejects past windows, preserves six Unknown rounds, defers paused Core, and settles only after certification",
  );
  state.scanMode = true;
  state.supply = 81n;
  await refresh();
  await page
    .getByRole("button", { name: "Check more HAMs", exact: true })
    .waitFor();
  assert.equal(await page.locator(".rival-list strong").count(), 0);
  await page
    .getByRole("button", { name: "Check more HAMs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Challenge HAM #81", exact: true })
    .waitFor();
  check(
    "Bounded discovery explains partial coverage and loads a rival beyond first 80 IDs",
  );
  state.scanMode = false;
  state.catalog = true;
  state.supply = 7n;
  await refresh();
  await page
    .getByRole("button", { name: "Challenge HAM #1", exact: true })
    .waitFor();
  assert.deepEqual(await page.locator(".rival-list strong").allTextContents(), [
    "HAM #1",
  ]);
  await page.locator(".rival-discovery").screenshot({ path: out + "/rivals-390.png" });
  check("Rivals exclude self, same owner, another band and locked HAMs");
  state.stamina = 9999n;
  await refresh();
  await wait(
    async () =>
      (await page.locator(".rival-list strong").allTextContents()).length === 2,
    "Top band rivals missing",
  );
  assert.deepEqual(await page.locator(".rival-list strong").allTextContents(), [
    "HAM #6",
    "HAM #7",
  ]);
  state.stamina = 10000n;
  await refresh();
  await page
    .getByRole("button", { name: "Challenge HAM #6", exact: true })
    .waitFor();
  check(
    "Stamina 9999 and cap 10000 share band 5; boundary 2000 is excluded from band 1",
  );
  state.stamina = 0n;
  await refresh();
  await page
    .getByRole("button", { name: "Challenge HAM #1", exact: true })
    .waitFor();
  await page.locator(".manual-challenge summary").click();
  if (!(await page.locator("#opponent").isVisible()))
    await page.locator(".manual-challenge summary").click();
  await page.locator("#opponent").fill("4");
  await page
    .locator(".manual-challenge")
    .getByRole("button", { name: "Challenge", exact: true })
    .click();
  await page
    .getByText("Choose a rival in the same Stamina band.", { exact: true })
    .waitFor();
  const beforeChallenge = sends;
  await page
    .getByRole("button", { name: "Challenge HAM #1", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Offered", exact: true })
    .waitFor();
  assert.equal(sends, beforeChallenge + 1);
  await page
    .getByText("Match #1 and link copied automatically.", { exact: false })
    .waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.includes("Match #1:") && copied.includes("?match=1"));
  assert.ok(new URL(page.url()).searchParams.get("match") === "1");
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Denied")),
    });
  });
  await page
    .getByRole("button", { name: "Copy match ID & link", exact: true })
    .click();
  await page
    .getByText("Clipboard unavailable; select and copy the link below.", {
      exact: false,
    })
    .waitFor();
  assert.ok(
    (await page.locator("#match-link").inputValue()).includes("?match=1"),
  );
  await page.evaluate(() => {
    delete navigator.clipboard.writeText;
  });
  check(
    "Clipboard denial leaves a selectable share link and a manual-copy recovery",
  );
  await page.screenshot({ path: out + "/outgoing-390.png", fullPage: true });
  check(
    "One-click Challenge simulates/sends existing MatchBook call, auto-copies ID/link, shows outgoing inbox",
  );
  state.nextMatchOverride = 65n;
  await page
    .getByRole("button", { name: "Refresh pending challenges", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check earlier matches", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Check earlier matches", exact: true })
    .click();
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor();
  state.nextMatchOverride = null;
  check(
    "Inbox scans newest-first with an explicit earlier-matches path; an older offer remains reachable",
  );
  await switchAccount(opponent.address);
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".match-inbox")
      .getByRole("button", { name: "Cancel", exact: true })
      .count(),
    0,
  );
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Accepted", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Save seed", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Settle race", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator(".race-stepper [aria-current]").textContent(),
    "2Accepted",
  );
  check(
    "Other owner sees incoming offer and accepts from inbox; stepper advances and +2 block/15s gates apply",
  );
  await page.locator(".race-status").screenshot({ path: out + "/accepted-stepper-390.png" });
  if (axeModule) {
    const scan = await new axeModule.AxeBuilder({ page }).analyze();
    result.axe.push({ view: "accepted-race", violations: scan.violations });
    assert.equal(scan.violations.length, 0);
  }
  state.block = state.race.randomBlock - 1n;
  state.now = state.race.readyAt;
  await refresh();
  assert.equal(
    await page
      .getByRole("button", { name: "Save seed", exact: true })
      .isDisabled(),
    true,
  );
  state.block += 1n;
  state.now = state.race.readyAt - 1n;
  await refresh();
  await wait(
    () =>
      page.getByRole("button", { name: "Save seed", exact: true }).isEnabled(),
    "Hash did not become available",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Settle race", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Save seed", exact: true }).click();
  await page.getByRole("button", { name: "Seed saved", exact: true }).waitFor();
  assert.equal(
    await page.locator(".race-stepper [aria-current]").textContent(),
    "3Save seed",
  );
  state.block = state.race.randomBlock + 300n;
  state.now = state.race.readyAt + 1n;
  state.failCore = true;
  await refresh();
  await page
    .getByText("Core unavailable · work unknown", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".network-label .good").count(), 0);
  assert.equal(
    await page
      .locator(".mint-state")
      .getByText("Open", { exact: true })
      .count(),
    1,
  );
  await wait(
    () =>
      page
        .getByRole("button", { name: "Settle race", exact: true })
        .isEnabled(),
    "Saved seed settlement blocked by Core failure",
  );
  await page.getByRole("button", { name: "Settle race", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match #1 · Settled", exact: true })
    .waitFor();
  check(
    "Seed only available after target block; saved seed survives 256 blocks and Core failure; settlement works after 15s",
  );
  state.failCore = false;
  // Reload a share link as the invited owner, independently of the selected HAM.
  state.race.state = 1;
  state.race.seed = fixedHash("0");
  state.race.offeredAt = state.now;
  state.race.readyAt = 0n;
  state.block += 1n;
  await page.goto(url + "?match=1#play", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page
    .getByRole("heading", { name: "Match #1 · Offered", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Accept challenge", exact: true })
    .waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page
    .getByRole("button", { name: "Accept challenge", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Accepted", exact: true })
    .waitFor();
  check(
    "?match=1 reload preserves wallet session and accepts directly from the shared link without opening sheet",
  );
  state.block = state.race.randomBlock + 255n;
  state.now = state.race.readyAt + 20n;
  await refresh();
  assert.equal(
    await page
      .getByRole("button", { name: "Save seed", exact: true })
      .isEnabled(),
    true,
  );
  state.block += 1n;
  await refresh();
  assert.equal(
    await page
      .getByRole("button", { name: "Save seed", exact: true })
      .isDisabled(),
    true,
  );
  await wait(
    () =>
      page
        .getByRole("button", { name: "Release expired race", exact: true })
        .isEnabled(),
    "Expired race remained locked",
  );
  await page
    .getByRole("button", { name: "Release expired race", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Expired", exact: true })
    .waitFor();
  check(
    "Unsaved hash inclusive target+256 boundary works; target+257 releases race without points",
  );
  state.race.state = 1;
  state.race.offeredAt = state.now - 3600n;
  await refresh();
  await page
    .getByRole("heading", { name: "Match #1 · Offered", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Accept challenge", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Release expired race", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Expired", exact: true })
    .waitFor();
  check("1h TTL blocks incoming acceptance and permits expired-offer release");
  state.race.state = 1;
  state.race.offeredAt = state.now;
  await switchAccount(account.address);
  await refresh();
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor();
  await page
    .locator(".match-inbox")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Match #1 · Cancelled", exact: true })
    .waitFor();
  check("Outgoing owner cancels from inbox and offer unlocks");
  state.failWiring = true;
  await refresh();
  assert.equal(
    await page
      .locator(".mint-state")
      .getByText("Open", { exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator(".network-label .good").count(), 0);
  state.failWiring = false;
  state.failMint = true;
  await refresh();
  assert.equal(
    await page
      .locator(".mint-state")
      .getByText("Unavailable", { exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator(".network-label .good").count(), 0);
  assert.ok(
    (await page.locator(".core-banner").innerText()).includes(
      "Core is catching up",
    ),
  );
  state.failMint = false;
  await refresh();
  check(
    "Wiring failures preserve mint reads; mint failures show Unavailable and remove green health, while Core stays readable",
  );
  await page.locator("#match-id").fill("bad");
  await page.getByRole("button", { name: "Load race", exact: true }).click();
  await page
    .locator("#match-error")
    .getByText("Enter a whole number.", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#match-id").getAttribute("aria-invalid"),
    "true",
  );
  await page.locator("#match-id").fill(url + "?match=1#play");
  await page.getByRole("button", { name: "Load race", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match #1 · Cancelled", exact: true })
    .waitFor();
  check("Match lookup validates IDs and supports pasted HTTPS/HTTP match URLs");
  const maximumId = ((1n << 256n) - 1n).toString();
  await page.locator("#match-id").fill(maximumId);
  await page.getByRole("button", { name: "Load race", exact: true }).click();
  await page.getByRole("heading", { name: `Match #${maximumId} · Not found`, exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator(".race-status").screenshot({ path: out + "/maximum-match-id-320.png" });
  await page.locator("#match-id").fill("1");
  await page.getByRole("button", { name: "Load race", exact: true }).click();
  await page.getByRole("heading", { name: "Match #1 · Cancelled", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  check("Maximum uint256 match ID wraps completely without page overflow at 320px");
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Invite friends", exact: true })
    .click();
  await page
    .getByText(
      "Invite service offline · links need registration before credit",
      { exact: true },
    )
    .waitFor();
  if (axeModule) {
    const scan = await new axeModule.AxeBuilder({ page }).analyze();
    result.axe.push({ view: "invite-offline", violations: scan.violations });
    assert.equal(scan.violations.length, 0);
  }
  await page.locator("#x-handle").fill("@Runner");
  await page
    .getByRole("button", { name: "Create invite link", exact: true })
    .click();
  assert.ok(
    (await page.locator("#invite-link").inputValue()).includes("?ref=runner"),
  );
  await page.screenshot({ path: out + "/invite-offline-390.png" });
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Leaderboards", exact: true })
    .click();
  await page.getByRole("button", { name: "Invite mints", exact: true }).click();
  await page
    .getByRole("heading", { name: "The invite board is offline.", exact: true })
    .waitFor();
  check(
    "Unconfigured invite service terminates loading and clearly marks registration/leaderboard offline; links still work",
  );
  await page.screenshot({ path: out + "/invite-offline-board.png" });
  serviceMode = "configured";
  await page.reload();
  await page.getByRole("button", { name: "Invite mints", exact: true }).click();
  await page
    .getByRole("heading", { name: "A fresh starting line.", exact: true })
    .waitFor();
  await page.screenshot({ path: out + "/invite-configured-empty.png" });
  check(
    "Explicit local service configuration loads genuine empty leaderboard without sample counts",
  );
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: /HAM #2 Stamina/ }).waitFor();
  for (const width of [320, 390, 760, 1080, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `Overflow at ${width}`);
    await page.screenshot({
      path: `${out}/layout-${width}.png`,
      fullPage: true,
    });
  }
  check(
    "Production export reflows without page overflow at 320/390/760/1080/1440",
  );
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  await phone.route("**/*", routeHandler);
  const phonePage = await phone.newPage();
  await phonePage.goto(url, { waitUntil: "load" });
  assert.equal(await phonePage.locator("dialog[open]").count(), 0);
  await phonePage
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  for (const wallet of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"]) {
    const link = phonePage.getByRole("link", {
      name: `Open in ${wallet}`,
      exact: true,
    });
    await link.waitFor();
    assert.ok((await link.getAttribute("href")).startsWith("https://"));
  }
  await phonePage
    .getByRole("button", { name: "Coinbase Smart Wallet", exact: false })
    .waitFor();
  await phonePage.screenshot({ path: out + "/wallet-phone.png" });
  await phonePage.keyboard.press("Escape");
  await phone.close();
  check(
    "Phone wallet sheet exposes four Open-in links plus Coinbase Smart Wallet, only after Connect",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  check(
    "No uncaught page errors or missing local assets in tested interactions",
  );
  result.errors = errors;
  result.missing = missing;
  result.limitations.push(
    "Controlled wallets and RPC only; no live signatures, real passkeys, screen-reader or native-device tests.",
  );
  await context.close();
} catch (error) {
  result.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (const p of pages) {
      await p
        .screenshot({ path: out + "/failure.png", fullPage: true })
        .catch(() => {});
      console.error((await p.locator("body").innerText()).slice(-8000));
    }
  }
} finally {
  await writeFile(
    out + "/results.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  await browser?.close();
  await new Promise((done) => server.close(done));
  api.server.close();
  api.store.close();
}
