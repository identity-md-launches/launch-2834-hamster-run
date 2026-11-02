import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeEventTopics, verifyMessage, zeroAddress } from "viem";
import { createInviteServer } from "./server.mjs";
import { InviteStore } from "./store.mjs";
import { deployment, normalizeHandle, verifyMint } from "./chain.mjs";

const account = () => privateKeyToAccount(generatePrivateKey());
const hash = (byte) => `0x${byte.repeat(64)}`;
async function withServer(run, { dbPath = ":memory:", ...options } = {}) {
  const app = createInviteServer({
    dbPath,
    verifier: {
      verifySignature: (address, message, signature) =>
        verifyMessage({ address, message, signature }),
      verifyMint: async () => ({ blockNumber: 100n, blockHash: hash("a") }),
    },
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const signed = async (who, action, handle, txHash) => {
    const c = await request("/challenge", {
      wallet: who.address,
      action,
      handle,
      txHash,
    });
    assert.equal(c.status, 200, JSON.stringify(c.data));
    return {
      challengeId: c.data.id,
      signature: await who.signMessage({ message: c.data.message }),
    };
  };
  try {
    await run({ app, request, signed });
  } finally {
    await app.close();
  }
}

test("X handles normalize and reject invalid or injected markup", () => {
  assert.equal(normalizeHandle(" @Little_Paws "), "little_paws");
  for (const value of [
    "",
    "@@a",
    "a-b",
    "a b",
    "abcdefghijklmnop",
    "<script>",
    "🐹",
  ])
    assert.throws(() => normalizeHandle(value));
});

test("signed registration, ownership, replay protection, and self-referral rejection", async () => {
  await withServer(async ({ request, signed }) => {
    const a = account(),
      b = account();
    const signature = await signed(a, "register", "@Tiny_Paws");
    assert.equal((await request("/register", signature)).status, 200);
    assert.equal((await request("/register", signature)).status, 401);
    assert.match(
      (await request("/register", await signed(b, "register", "tiny_paws")))
        .data.error,
      /another wallet/,
    );
    assert.match(
      (await request("/register", await signed(a, "register", "second_name")))
        .data.error,
      /already registered/,
    );
    assert.equal(
      (
        await request("/challenge", {
          wallet: a.address,
          action: "attribute",
          handle: "tiny_paws",
          txHash: hash("b"),
        })
      ).status,
      409,
    );
    const c = await request("/challenge", {
      wallet: b.address,
      action: "register",
      handle: "other",
    });
    const bad = await a.signMessage({ message: c.data.message });
    assert.equal(
      (await request("/register", { challengeId: c.data.id, signature: bad }))
        .status,
      401,
    );
    assert.equal(
      (
        await request("/health", undefined, {
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
  });
});

test("verified mint credit is once per wallet, ranked, atomic, and persists after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hamsterrun-test-")),
    path = join(dir, "invites.sqlite");
  const a = account(),
    b = account(),
    c = account(),
    d = account();
  try {
    await withServer(
      async ({ request, signed }) => {
        await request("/register", await signed(a, "register", "alpha"));
        await request("/register", await signed(b, "register", "beta"));
        const one = await signed(c, "attribute", "alpha", hash("c"));
        const results = await Promise.all([
          request("/attribute", one),
          request("/attribute", one),
        ]);
        assert.equal(results.filter((r) => r.status === 200).length, 1);
        const again = await request(
          "/attribute",
          await signed(c, "attribute", "beta", hash("c")),
        );
        assert.equal(again.data.alreadyCredited, true);
        assert.equal(again.data.handle, "alpha");
        await request(
          "/attribute",
        await signed(d, "attribute", "alpha", hash("c")),
        );
        assert.deepEqual((await request("/leaderboard")).data.entries, [
          { handle: "alpha", count: 2 },
        ]);
      },
      { dbPath: path },
    );
    const reopened = new InviteStore(path);
    assert.deepEqual(reopened.leaderboard(), [{ handle: "alpha", count: 2 }]);
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("expired and action-mismatched challenges cannot be used", async () => {
  await withServer(async ({ app, request, signed }) => {
    const payload = await signed(account(), "register", "expired");
    app.store.db
      .prepare("UPDATE challenges SET expires = ? WHERE id = ?")
      .run(Date.now() - 1, payload.challengeId);
    assert.equal((await request("/register", payload)).status, 401);
    const other = await signed(account(), "register", "mismatch");
    assert.equal((await request("/attribute", other)).status, 401);
  });
});

test("mint verifier checks chain, success, confirmation depth, recipient, public mint transition, and canonical block", async () => {
  const who = account().address;
  const log = {
    address: deployment.contracts.HamsterRunNFT,
    data: "0x",
    topics: encodeEventTopics({
      abi: [
        {
          type: "event",
          name: "Transfer",
          inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
          ],
        },
      ],
      eventName: "Transfer",
      args: { from: zeroAddress, to: who, tokenId: 1n },
    }),
  };
  const receipt = {
    status: "success",
    blockNumber: 100n,
    blockHash: hash("a"),
    logs: [log],
  };
  const mock = (overrides) => ({
    getChainId: async () => 11155111,
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 101n,
    readContract: async ({ blockNumber }) => blockNumber === 100n,
    getBlock: async () => ({ hash: hash("a") }),
    ...overrides,
  });
  assert.equal((await verifyMint(mock(), who, hash("c"))).blockNumber, 100n);
  await assert.rejects(
    verifyMint(mock({ getChainId: async () => 1 }), who, hash("c")),
    /Sepolia/,
  );
  await assert.rejects(
    verifyMint(
      mock({
        getTransactionReceipt: async () => ({ ...receipt, status: "reverted" }),
      }),
      who,
      hash("c"),
    ),
    /successful/,
  );
  await assert.rejects(
    verifyMint(mock({ getBlockNumber: async () => 100n }), who, hash("c")),
    /two confirmations/,
  );
  await assert.rejects(
    verifyMint(mock(), account().address, hash("c")),
    /does not mint/,
  );
  await assert.rejects(
    verifyMint(mock({ readContract: async () => false }), who, hash("c")),
    /first successful public mint/,
  );
  await assert.rejects(
    verifyMint(mock({ readContract: async () => true }), who, hash("c")),
    /first successful public mint/,
  );
  await assert.rejects(
    verifyMint(
      mock({ getBlock: async () => ({ hash: hash("b") }) }),
      who,
      hash("c"),
    ),
    /reorganization/,
  );
});

test("failed mint verification never creates a shared credit", async () => {
  await withServer(
    async ({ request, signed }) => {
      const ref = account(),
        minter = account();
      await request("/register", await signed(ref, "register", "paws"));
      const r = await request(
        "/attribute",
        await signed(minter, "attribute", "paws", hash("e")),
      );
      assert.equal(r.status, 400);
      assert.deepEqual((await request("/leaderboard")).data.entries, []);
    },
    {
      verifier: {
        verifySignature: (address, message, signature) =>
          verifyMessage({ address, message, signature }),
        verifyMint: async () => {
          throw new Error("Mint reverted.");
        },
      },
    },
  );
});
