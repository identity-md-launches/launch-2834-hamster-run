// Read-only public Sepolia smoke check. Never requests a wallet or sends a transaction.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";
const args = process.argv.slice(2);
const option = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
};
const playwright = await import(
  option("--playwright")
    ? pathToFileURL(resolve(option("--playwright"))).href
    : "playwright"
);
const root = resolve(fileURLToPath(new URL("../../dist/", import.meta.url)));
const out = resolve(
  option("--out") ||
    fileURLToPath(new URL("../../test/scratch/live/", import.meta.url)),
);
await mkdir(out, { recursive: true });
const deployment = JSON.parse(
  await readFile(resolve(root, "imd-deployment.json"), "utf8"),
);
const abis = JSON.parse(
  await readFile(new URL("../src/abis.json", import.meta.url), "utf8"),
);
const client = createPublicClient({
  transport: http(deployment.network.rpcUrls[0], {
    timeout: 12000,
    retryCount: 0,
  }),
});
assert.equal(await client.getChainId(), deployment.chainId);
const block = await client.getBlock();
const read = (name, functionName) =>
  client.readContract({
    address: deployment.contracts[name],
    abi: abis[name],
    functionName,
    blockNumber: block.number,
  });
const [supply, mintOpen, genesisTimestamp, status, codes] = await Promise.all([
  read("HamsterRunNFT", "totalSupply"),
  read("HamsterRunNFT", "mintOpen"),
  read("CoreReader", "genesisTimestamp"),
  read("CoreReader", "status"),
  Promise.all(
    Object.values(deployment.contracts).map((address) =>
      client.getCode({ address, blockNumber: block.number }),
    ),
  ),
]);
assert.ok(codes.every((code) => code && code !== "0x"));
const result = {
  chainId: deployment.chainId,
  publicRpc: deployment.network.rpcUrls[0],
  block: block.number,
  timestamp: block.timestamp,
  supply,
  mintOpen,
  genesisTimestamp,
  current: status[0],
  frontier: status[1],
  paused: status[2],
  lag: status[3],
  allSixContractsHaveCode: true,
  errors: [],
  missing: [],
  fonts: {},
  screenshots: [],
  limitations: [
    "Read-only public RPC observation; no live transaction, wallet signature or invite backend deployment.",
  ],
};
const mimes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  if (!path.startsWith("/preview/")) {
    res.writeHead(404).end();
    return;
  }
  const relative = path.slice("/preview/".length) || "index.html";
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "content-type",
      mimes[extname(file)] || "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/preview/") && r.status() >= 400)
      result.missing.push(r.url());
  });
  const url = `http://127.0.0.1:${server.address().port}/preview/`;
  await page.goto(url, { waitUntil: "load" });
  await page
    .locator(".mint-state")
    .getByText(mintOpen ? "Open" : "Closed", { exact: true })
    .waitFor({ timeout: 60000 });
  assert.equal(await page.locator("dialog[open]").count(), 0);
  result.coreBanner = await page.locator(".core-banner").innerText();
  result.mintPanel = await page.locator(".mint-panel").innerText();
  result.fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      nunito: document.fonts.check("16px Nunito"),
      pixelify: document.fonts.check("700 32px Pixelify"),
    };
  });
  for (const width of [320, 390, 760, 1080, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (width === 390 || width === 1440) {
      await page.screenshot({ path: `${out}/play-${width}.png` });
      result.screenshots.push(`play-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.screenshot({ path: `${out}/invite-390.png` });
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "Leaderboards", exact: true })
    .click();
  await page.getByRole("button", { name: "Invite mints", exact: true }).click();
  await page
    .getByRole("heading", { name: "The invite board is offline.", exact: true })
    .waitFor();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
  console.log(
    JSON.stringify({
      passed: true,
      chainId: result.chainId,
      block: result.block.toString(),
      supply: result.supply.toString(),
      mintOpen: result.mintOpen,
      fonts: result.fonts,
      screenshots: result.screenshots,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(
    `${out}/results.json`,
    JSON.stringify(
      result,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n",
  );
}
