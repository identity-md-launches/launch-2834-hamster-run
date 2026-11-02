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
            ? 1n
            : state.minted
              ? 1n
              : 0n,
        stamina: BigInt(a[0] || 0) === 2n ? state.stamina : 0n,
        matchLocked: Boolean(
          state.race &&
          ((state.race.state === 1 && BigInt(a[0] || 0) === 2n) ||
            state.race.state === 2),
        ),
      };
      if (f === "ownerOf")
        result = BigInt(a[0]) === 1n ? opponent.address : account.address;
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
        result = state.race || {
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
  const live = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const liveErrors = [];
  live.on("pageerror", (e) => liveErrors.push(e.message));
  await live.goto(url, { waitUntil: "load" });
  await live
    .getByText("mintOpen", { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(async (e) => {
      console.log("Live page body:", await live.locator("body").innerText());
      console.log("Live errors:", liveErrors);
      await live.screenshot({ path: out + "/load-error.png" });
      throw e;
    });
  await wait(
    () =>
      live
        .locator(".mint-state code")
        .innerText()
        .then((t) => t !== "unknown"),
    "Live Sepolia read did not finish",
  ).catch((e) => result.limitations.push(e.message));
  result.live = await live.locator(".core-banner").innerText();
  result.liveDetails = await live.locator(".core-banner details").textContent();
  result.live += "\n" + (await live.locator(".mint-panel").innerText());
  result.liveErrors = liveErrors;
  await live.screenshot({ path: out + "/live-390.png" });
  await live.close();

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
    ({ address, icon }) => {
      const listeners = {};
      const provider = {
        accounts: [address],
        chainId: "0xaa36a7",
        authorized: false,
        request: async ({ method, params = [] }) => {
          if (method === "eth_accounts")
            return provider.authorized ? provider.accounts : [];
          if (method === "eth_requestAccounts") {
            provider.authorized = true;
            return provider.accounts;
          }
          if (method === "eth_chainId") return provider.chainId;
          if (
            method === "wallet_switchEthereumChain" ||
            method === "wallet_addEthereumChain"
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
        emit: (event, data) =>
          (listeners[event] || []).forEach((fn) => fn(data)),
      };
      window.__testWallet = provider;
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "4efc6dd9-5c50-4412-9b2d-bdc87fc5ba58",
                name: "Validation wallet",
                icon,
                rdns: "test.hamsterrun.wallet",
              },
              provider,
            },
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    {
      address: account.address,
      icon:
        "data:image/svg+xml," +
        encodeURIComponent(
          await readFile(
            new URL("../public/wallets/coinbase.svg", import.meta.url),
            "utf8",
          ),
        ),
    },
  );
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/site-config.json"))
      return route.fulfill({ json: { inviteServiceUrl: origin + "/api" } });
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
  });
  const page = await context.newPage(),
    errors = [],
    missing = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400)
      missing.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(url + "?ref=friend", { waitUntil: "load" });
  await page
    .locator(".mint-state code")
    .getByText("true", { exact: true })
    .waitFor();
  const mint = page.getByRole("button", { name: "Mint a hamster" });
  assert.ok(
    (await mint.boundingBox()).y + (await mint.boundingBox()).height < 844,
  );
  check("390px first screen contains product and primary mint action");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Validation wallet" }).waitFor();
  await page.keyboard.press("Tab");
  await page.screenshot({ path: out + "/wallet-keyboard.png" });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineWidth,
    ),
    "3px",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Connect wallet",
  );
  check(
    "EIP-6963 discovery hides generic row; Escape closes and restores focus",
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
  await wait(() => mint.isEnabled(), "Mint stayed disabled after switching");
  check("Wrong network disables writes and wallet control switches to Sepolia");
  state.rejectNext = true;
  await mint.click();
  await page
    .getByText("Request declined in your wallet. You can try again.")
    .waitFor();
  assert.equal(sends, 0);
  check("Wallet rejection has a retry and sends no transaction");
  state.mintOpen = false;
  await mint.click();
  await page
    .locator(".transaction-notice")
    .getByText("Mint closed / owner wiring pending.", { exact: false })
    .waitFor();
  state.mintOpen = true;
  state.minted = true;
  await mint.click();
  await page
    .getByText(
      "This wallet has already minted, or all 10,000 HAMs have been minted.",
      { exact: true },
    )
    .waitFor();
  state.minted = false;
  assert.equal(sends, 0);
  check("MintClosed and MintLimit contract errors are clear before sending");
  await mint.click();
  await page
    .getByRole("button", { name: "Your HAM is already minted" })
    .waitFor();
  await page.getByRole("button", { name: /HAM #2 Stamina/ }).waitFor();
  assert.equal(sends, 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Your HAM is already minted" })
      .isDisabled(),
    true,
  );
  check(
    "Free public mint confirms, ownership and Stamina load, lifetime mint disables",
  );
  await page
    .getByText("Mint confirmed. Invite credited to @friend.", { exact: false })
    .waitFor();
  assert.deepEqual(
    await fetch(origin + "/api/leaderboard").then((r) => r.json()),
    { entries: [{ handle: "friend", count: 1 }] },
  );
  check(
    "Successful mint with ?ref attributes once through a signed backend request",
  );
  assert.equal(
    await page.getByRole("button", { name: "Book training" }).isDisabled(),
    true,
  );
  await page
    .getByText("Owner wiring pending. Training is not open yet.", {
      exact: true,
    })
    .waitFor();
  state.wired = true;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await wait(
    () => page.getByRole("button", { name: "Book training" }).isEnabled(),
    "Game wiring was not refreshed",
  );
  check(
    "Open mint works before game wiring; training waits for completed wiring",
  );
  await page.locator("#start-round").fill("2999");
  await page.getByRole("button", { name: "Book training" }).click();
  await page.getByText("Choose a first round from", { exact: false }).waitFor();
  assert.equal(sends, 1);
  await page.locator("#start-round").fill("3002");
  await page.getByRole("button", { name: "Book training" }).click();
  await page
    .getByRole("button", { name: "Waiting for certification" })
    .waitFor();
  assert.equal(
    await page.locator(".round").getByText("Unknown", { exact: true }).count(),
    6,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Waiting for certification" })
      .isDisabled(),
    true,
  );
  check("Future 6-round window books; uncertified round work remains Unknown");
  state.paused = true;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await page
    .getByRole("button", { name: "Core paused", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Core paused", exact: true })
      .isDisabled(),
    true,
  );
  check("Paused Core banner persists and training settlement disables");
  state.paused = false;
  state.current = 3012n;
  state.frontier = 3007n;
  state.now = genesis + 3011n * 600n + 30n;
  state.block += 1n;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  const settleTrain = page.getByRole("button", {
    name: "Settle certified training",
  });
  await wait(
    () => settleTrain.isEnabled(),
    "Certified window did not become ready",
  );
  await settleTrain.click();
  await page.getByText("Settled · 123 certified trainWork").waitFor();
  check("Training settles only after frontier covers all six rounds");
  await page.locator("#opponent").fill("1");
  await page.getByRole("button", { name: "Challenge →", exact: true }).click();
  await page.getByRole("heading", { name: "Match #1 · Offered" }).waitFor();
  await page.evaluate((address) => {
    window.__testWallet.accounts = [address];
    window.__testWallet.emit("accountsChanged", [address]);
  }, opponent.address);
  await wait(
    () => page.getByRole("button", { name: "Accept challenge" }).isEnabled(),
    "Opponent acceptance did not enable",
  );
  await page.getByRole("button", { name: "Accept challenge" }).click();
  await page.getByRole("heading", { name: "Match #1 · Running" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Settle race", exact: true })
      .isDisabled(),
    true,
  );
  state.block += 4n;
  state.now += 20n;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await wait(
    () => page.getByRole("button", { name: "Save race seed" }).isEnabled(),
    "Race seed capture did not enable",
  );
  await page.getByRole("button", { name: "Save race seed" }).click();
  await page.getByText("Race seed saved.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Settle race", exact: true }).click();
  await page.getByRole("heading", { name: "Match #1 · Settled" }).waitFor();
  check(
    "1v1 challenge, opposing-wallet acceptance, future-block guard, seed capture and settlement",
  );
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Leaderboards" })
    .click();
  await page.getByRole("cell", { name: "322", exact: true }).waitFor();
  check("Weekly board uses 123 + floor(19999/100) = 322");
  await page.getByRole("button", { name: "Invite mints", exact: true }).click();
  await page.getByRole("rowheader", { name: "@friend", exact: true }).waitFor();
  check(
    "Invite board shows the verified mint count separately from SeasonBoard",
  );
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Invite friends" })
    .click();
  const inviteAction = await page
    .getByRole("button", { name: "Create invite link" })
    .boundingBox();
  assert.ok(
    inviteAction.y + inviteAction.height < 844,
    "Invite action should fit the first 390px screen",
  );
  await page.locator("#x-handle").fill("@BAD-HANDLE");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await page
    .getByText("Use 1–15 letters, numbers, or underscores for your X handle.", {
      exact: true,
    })
    .waitFor();
  await page.locator("#x-handle").fill("@Tiny_Paws");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await page
    .getByText("Handle registered. Your link is ready to share.")
    .waitFor();
  assert.equal(
    await page.locator("#invite-link").inputValue(),
    url + "?ref=tiny_paws",
  );
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await page.getByText("Invite link copied.", { exact: true }).waitFor();
  check(
    "X handle validation, normalization, wallet signature, persistent registration and subpath share URL",
  );
  await page.screenshot({ path: out + "/invite-390.png", fullPage: true });
  if (axeModule) {
    const AxeBuilder = axeModule.default || axeModule.AxeBuilder;
    const scan = await new AxeBuilder({ page }).analyze();
    result.axe.push({
      view: "invites",
      violations: scan.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
    assert.equal(
      scan.violations.length,
      0,
      "Invite accessibility audit failed",
    );
  }
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Play", exact: true })
    .click();
  state.mintOpen = false;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await page
    .getByText("Mint closed / owner wiring pending", { exact: true })
    .waitFor();
  check("mintOpen=false shows closed/owner-wiring message and disabled CTA");
  state.failRead = true;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await page
    .getByText("Core unavailable · work unknown", { exact: true })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await page.getByRole("button", { name: "Book training" }).isDisabled(),
    true,
  );
  check(
    "Read failure makes Core unknown and disables writes instead of inventing zeros",
  );
  state.failRead = false;
  await page.getByRole("button", { name: "Refresh Sepolia state" }).click();
  await page.getByText("Core is catching up", { exact: true }).waitFor();
  for (const width of [320, 390, 760, 1080, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${width}px horizontal overflow`,
    );
    await page.screenshot({ path: out + `/play-${width}.png`, fullPage: true });
  }
  check(
    "No page overflow at 320, 390, 760, 1080 and 1440; relative assets work under /preview/",
  );
  await page.locator(".site-footer .brand").click();
  await wait(()=>page.evaluate(()=>scrollY===0),"Home link did not return to the top");
  check("Footer home navigation returns to the game at the top of the page");
  if (axeModule) {
    const AxeBuilder = axeModule.default || axeModule.AxeBuilder;
    const scan = await new AxeBuilder({ page }).analyze();
    result.axe.push({
      view: "play",
      violations: scan.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
    assert.equal(scan.violations.length, 0, "Play accessibility audit failed");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  check(
    "No uncaught script errors or missing local resources across primary interactions",
  );
  await context.close();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(url);
  await phonePage.getByRole("button", { name: "Connect wallet" }).click();
  for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
    await phonePage
      .getByRole("link", { name: "Open in " + name, exact: true })
      .waitFor();
  await phonePage
    .getByRole("button", { name: "Coinbase Smart Wallet" })
    .waitFor();
  const rabbyUrl = new URL(
    await phonePage
      .getByRole("link", { name: "Open in Rabby", exact: true })
      .getAttribute("href"),
  );
  assert.equal(rabbyUrl.pathname, "/mobile/");
  assert.equal(rabbyUrl.searchParams.get("_cmd"), "open-dapp");
  assert.equal(rabbyUrl.searchParams.get("dapp"), phonePage.url());
  await phonePage.screenshot({ path: out + "/wallet-phone.png" });
  check("Phone sheet has all four Open in links and Coinbase Smart Wallet");
  await phonePage.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "9cf956bd-060a-4c41-83b4-5868565847ac",
            name: "Phone validation wallet",
            rdns: "test.hamsterrun.phone",
            icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
          },
          provider: {
            request: async () => [],
            on: () => {},
            removeListener: () => {},
          },
        },
      }),
    );
  });
  await phonePage
    .getByRole("button", { name: "Phone validation wallet", exact: false })
    .waitFor();
  assert.equal(
    await phonePage
      .getByRole("link", { name: "Open in MetaMask", exact: true })
      .count(),
    0,
  );
  check("Phone EIP-6963 provider remains connectable without window.ethereum");
  await phone.close();
  try {
    const safari = await playwright.webkit.launch({ headless: true });
    await safari.close();
    result.limitations.push(
      "WebKit launched but no independent signed wallet flow was run.",
    );
  } catch (e) {
    result.limitations.push(
      "WebKit could not launch: missing host libraries. Chromium phone emulation is not a physical iPhone test.",
    );
  }
} catch (error) {
  result.error = error.stack;
  console.error(error);
  for (const context of browser?.contexts() || [])
    for (const page of context.pages()) {
      result.lastBody = await page
        .locator("body")
        .innerText()
        .catch(() => "unavailable");
      await page
        .screenshot({ path: out + "/failure.png", fullPage: true })
        .catch(() => {});
    }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  api.store.close();
  await writeFile(out + "/results.json", JSON.stringify(result, null, 2));
}
