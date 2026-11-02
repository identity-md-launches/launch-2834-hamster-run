import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { InviteStore } from "./store.mjs";
import {
  createVerifier,
  deployment,
  normalizeHandle,
  normalizeWallet,
} from "./chain.mjs";

const mimes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain",
};
export function createInviteServer({
  dbPath,
  origins = [],
  verifier = createVerifier(),
  staticDir = null,
} = {}) {
  const store = new InviteStore(
    dbPath || fileURLToPath(new URL("./data/invites.sqlite", import.meta.url)),
  );
  const limits = new Map();
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const origin = req.headers.origin;
      const ownOrigin = `http://${req.headers.host}`;
      if (origin && origin !== ownOrigin && !origins.includes(origin))
        return reply(403, {
          error: "This site origin is not allowed by the invite service.",
        });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.writeHead(204);
        return res.end();
      }
      const path = url.pathname.replace(/\/$/, "");
      if (req.method === "GET" && path === "/api/health")
        return reply(200, {
          ok: true,
          chainId: deployment.chainId,
          storage: "sqlite",
        });
      if (req.method === "GET" && path === "/api/leaderboard")
        return reply(200, { entries: store.leaderboard() });
      if (
        req.method === "POST" &&
        ["/api/challenge", "/api/register", "/api/attribute"].includes(path)
      ) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return reply(415, { error: "Send JSON." });
        const key = req.socket.remoteAddress || "local";
        const now = Date.now();
        const rate = limits.get(key);
        if (rate && now - rate.at < 60_000 && rate.count >= 40)
          return reply(429, {
            error: "Too many invite requests. Retry in one minute.",
          });
        limits.set(
          key,
          rate && now - rate.at < 60_000
            ? { ...rate, count: rate.count + 1 }
            : { at: now, count: 1 },
        );
        if (limits.size > 2000)
          for (const [k, v] of limits)
            if (now - v.at > 60_000) limits.delete(k);
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 12_000)
            return reply(413, { error: "Request too large." });
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return reply(400, { error: "Invalid JSON." });
        }
        if (path === "/api/challenge") {
          const wallet = normalizeWallet(body.wallet),
            handle = normalizeHandle(body.handle);
          if (!["register", "attribute"].includes(body.action))
            return reply(400, { error: "Choose register or attribute." });
          const txHash = body.action === "attribute" ? body.txHash : undefined;
          if (
            body.action === "attribute" &&
            (typeof txHash !== "string" ||
              !/^0x[\da-f]{64}$/i.test(txHash) ||
              BigInt(txHash) === 0n)
          )
            return reply(400, {
              error: "A public mint transaction hash is required.",
            });
          if (body.action === "attribute") {
            const ref = store.handle(handle);
            if (!ref)
              return reply(404, {
                error:
                  "This invite handle is not registered. Its owner needs to register it first.",
              });
            if (ref.wallet.toLowerCase() === wallet)
              return reply(409, { error: "Self-invites do not count." });
          }
          const expires = now + 300_000,
            id = randomUUID();
          const message = `HamsterRun off-chain invite\nAction: ${body.action}\nChain: ${deployment.chainId}\nCollection: ${deployment.contracts.HamsterRunNFT}\nWallet: ${wallet}\nHandle: @${handle}\nMint transaction: ${txHash || "not applicable"}\nSite: ${origin || ownOrigin}\nNonce: ${randomBytes(24).toString("hex")}\nExpires: ${new Date(expires).toISOString()}\nThis signature only manages invite credit. It sends no transaction.`;
          store.createChallenge({
            id,
            wallet,
            handle,
            action: body.action,
            txHash,
            message,
            expires,
          });
          return reply(200, { id, message, expires });
        }
        if (
          typeof body.challengeId !== "string" ||
          typeof body.signature !== "string" ||
          body.signature.length > 10_000 ||
          !/^0x[\da-f]+$/i.test(body.signature)
        )
          return reply(400, { error: "Provide a signature and challenge ID." });
        const c = store.getChallenge(body.challengeId);
        const action = path === "/api/register" ? "register" : "attribute";
        if (!c || c.action !== action || c.expires < now)
          return reply(401, {
            error:
              "Signature challenge expired or was already used. Request a new one.",
          });
        if (
          !(await verifier.verifySignature(c.wallet, c.message, body.signature))
        )
          return reply(401, {
            error:
              "Signature does not match the minting wallet. Reconnect and retry.",
          });
        if (action === "register") return reply(200, store.register(c));
        const proof = await verifier.verifyMint(c.wallet, c.tx_hash);
        return reply(200, store.attribute(c, proof));
      }
      if (
        req.method === "GET" &&
        staticDir &&
        !url.pathname.startsWith("/api")
      ) {
        const root = resolve(staticDir),
          file = resolve(
            root,
            "." + decodeURIComponent(url.pathname),
            url.pathname.endsWith("/") ? "index.html" : "",
          );
        if (!file.startsWith(root + sep))
          return reply(403, { error: "Invalid path." });
        try {
          const data = await readFile(file);
          res.writeHead(200, {
            "Content-Type": mimes[extname(file)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
          });
          return res.end(data);
        } catch {
          return reply(404, { error: "File not found." });
        }
      }
      return reply(404, { error: "Invite endpoint not found." });
    } catch (error) {
      return reply(400, {
        error:
          error.message?.slice(0, 300) || "Invite request failed. Retry later.",
      });
    }
  });
  return {
    server,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    option = (name) => {
      const i = args.indexOf(name);
      return i < 0 ? undefined : args[i + 1];
    };
  const port = Number(option("--port") || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  const origins = (option("--origin") || "")
    .split(",")
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  const app = createInviteServer({
    dbPath: option("--db"),
    origins,
    staticDir: option("--static"),
    verifier: createVerifier(option("--rpc") ? [option("--rpc")] : undefined),
  });
  app.server.listen(port, option("--host") || "127.0.0.1", () =>
    console.log(
      `HamsterRun invite service listening on port ${port}. SQLite persists profiles and verified credits.`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
