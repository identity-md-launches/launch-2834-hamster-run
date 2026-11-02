import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class InviteStore {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS handles (
        handle TEXT PRIMARY KEY COLLATE NOCASE,
        wallet TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY, wallet TEXT NOT NULL, action TEXT NOT NULL, handle TEXT NOT NULL,
        tx_hash TEXT, message TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credits (
        wallet TEXT PRIMARY KEY COLLATE NOCASE,
        referrer TEXT NOT NULL REFERENCES handles(handle),
        tx_hash TEXT NOT NULL COLLATE NOCASE,
        block_number TEXT NOT NULL, block_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }
  close() {
    this.db.close();
  }
  createChallenge(c) {
    this.db.prepare("DELETE FROM challenges WHERE expires < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO challenges VALUES (?,?,?,?,?,?,?)")
      .run(
        c.id,
        c.wallet,
        c.action,
        c.handle,
        c.txHash ?? null,
        c.message,
        c.expires,
      );
  }
  getChallenge(id) {
    return this.db.prepare("SELECT * FROM challenges WHERE id = ?").get(id);
  }
  handle(handle) {
    return this.db
      .prepare("SELECT * FROM handles WHERE handle = ?")
      .get(handle);
  }
  profile(wallet) {
    return this.db
      .prepare("SELECT * FROM handles WHERE wallet = ?")
      .get(wallet);
  }
  credit(wallet) {
    return this.db
      .prepare("SELECT * FROM credits WHERE wallet = ?")
      .get(wallet);
  }
  atomic(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  consume(id) {
    if (
      this.db
        .prepare("DELETE FROM challenges WHERE id = ? AND expires >= ?")
        .run(id, Date.now()).changes !== 1
    )
      throw new Error(
        "Signature challenge expired or was already used. Request a new one.",
      );
  }
  register(challenge) {
    return this.atomic(() => {
      const current = this.handle(challenge.handle),
        profile = this.profile(challenge.wallet);
      if (
        current &&
        current.wallet.toLowerCase() !== challenge.wallet.toLowerCase()
      )
        throw new Error(
          "That handle is registered by another wallet. Choose your own handle.",
        );
      if (profile && profile.handle !== challenge.handle)
        throw new Error(
          `This wallet already registered @${profile.handle}. One handle per wallet keeps invite history stable.`,
        );
      this.consume(challenge.id);
      this.db
        .prepare("INSERT OR IGNORE INTO handles VALUES (?,?,?)")
        .run(challenge.handle, challenge.wallet.toLowerCase(), Date.now());
      return { handle: challenge.handle };
    });
  }
  attribute(challenge, proof) {
    return this.atomic(() => {
      const ref = this.handle(challenge.handle);
      if (!ref)
        throw new Error(
          "This invite handle is not registered. Its owner needs to register it first.",
        );
      if (ref.wallet.toLowerCase() === challenge.wallet.toLowerCase())
        throw new Error("Self-invites do not count.");
      const existing = this.credit(challenge.wallet);
      this.consume(challenge.id);
      if (existing)
        return {
          handle: existing.referrer,
          credited: false,
          alreadyCredited: true,
        };
      this.db
        .prepare("INSERT INTO credits VALUES (?,?,?,?,?,?)")
        .run(
          challenge.wallet.toLowerCase(),
          challenge.handle,
          challenge.tx_hash.toLowerCase(),
          String(proof.blockNumber),
          proof.blockHash,
          Date.now(),
        );
      return { handle: challenge.handle, credited: true };
    });
  }
  leaderboard() {
    return this.db
      .prepare(
        `SELECT h.handle, COUNT(c.wallet) AS count FROM handles h
      JOIN credits c ON c.referrer = h.handle GROUP BY h.handle ORDER BY count DESC, h.handle ASC LIMIT 100`,
      )
      .all()
      .map((row) => ({ handle: row.handle, count: row.count }));
  }
}
