#!/usr/bin/env node
// Prepare unsigned, reviewable transactions. This program never connects a wallet or broadcasts.
import { readFileSync } from "node:fs";
import { Interface, getAddress } from "../demo/vendor/ethers-6.13.5.min.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tools/owner-actions.mjs <confirmed-deployment.json>");
const deployment = JSON.parse(readFileSync(path, "utf8"));
if (deployment.chainId !== 11155111) throw new Error("The deployment must be on Sepolia.");
const names = ["CoreReader", "HamsterRunNFT", "PointsLedger", "SeasonBoard", "TrainBook", "MatchBook"];
const contracts = {};
for (const name of names) {
  const value = deployment.contracts?.[name];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) {
    throw new Error(`Missing confirmed deployment address: ${name}`);
  }
  contracts[name] = getAddress(value);
}
if (new Set(Object.values(contracts)).size !== names.length) throw new Error("Deployment addresses must be distinct.");
const abis = JSON.parse(readFileSync(new URL("../demo/abis.json", import.meta.url), "utf8"));
const specs = [
  ["HamsterRunNFT", "configureBooks", [contracts.TrainBook, contracts.MatchBook]],
  ["PointsLedger", "configureWriters", [contracts.MatchBook, contracts.SeasonBoard]],
  ["SeasonBoard", "configureBooks", [contracts.TrainBook, contracts.MatchBook]],
  ["HamsterRunNFT", "setMintOpen", [true]],
];
const transactions = specs.map(([name, method, args]) => ({
  description: `${name}.${method} — inspect addresses and simulate before signing`,
  chainId: "0xaa36a7",
  from: "0xBFB53C8E9518bA748e94Ae075E2bE561d9BAC472",
  to: contracts[name],
  value: "0x0",
  data: new Interface(abis[name]).encodeFunctionData(method, args),
}));
console.log(JSON.stringify({ note: "UNSIGNED. Check against the confirmed launch receipt. Execute in order using the named owner's wallet. Skip already completed configuration calls. If ownership was transferred, the current owner must act.", transactions }, null, 2));
