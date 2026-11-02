import { readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
const load = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const abis = load("../src/abis.json"),
  d = load("../src/deployment.json");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
for (const [name, abi] of Object.entries(abis)) {
  const hash = keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
  if (hash !== d.abiHashes[name])
    throw new Error(`${name} ABI hash mismatch: ${hash}`);
  console.log(`${name}: canonical ABI hash matches deployment receipt`);
}
