import {
  createPublicClient,
  decodeEventLog,
  fallback,
  http,
  isAddress,
  zeroAddress,
} from "viem";
import { readFileSync } from "node:fs";

export const deployment = JSON.parse(
  readFileSync(new URL("../src/deployment.json", import.meta.url), "utf8"),
);
const allAbis = JSON.parse(
  readFileSync(new URL("../src/abis.json", import.meta.url), "utf8"),
);
const nftAbi = allAbis.HamsterRunNFT;
export const normalizeHandle = (value) => {
  if (typeof value !== "string") throw new Error("Enter an X handle.");
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle))
    throw new Error(
      "Use 1–15 letters, numbers, or underscores for your X handle.",
    );
  return handle;
};
export function normalizeWallet(value) {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: false }) ||
    value.toLowerCase() === zeroAddress
  )
    throw new Error("Use a valid, nonzero wallet address.");
  return value.toLowerCase();
}
export function createVerifier(rpcUrls = deployment.rpcUrls) {
  const client = createPublicClient({
    transport: fallback(
      rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 0 })),
      { retryCount: 0 },
    ),
  });
  return {
    verifySignature: (wallet, message, signature) =>
      client.verifyMessage({ address: wallet, message, signature }),
    verifyMint: async (wallet, hash) => verifyMint(client, wallet, hash),
  };
}
export async function verifyMint(client, wallet, hash) {
  if (!/^0x[\da-f]{64}$/i.test(hash) || BigInt(hash) === 0n)
    throw new Error("Use the successful public mint transaction hash.");
  if ((await client.getChainId()) !== deployment.chainId)
    throw new Error("Invite verifier RPC must be on Sepolia.");
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error("Only a successful mint can count as an invite.");
  if ((await client.getBlockNumber()) < receipt.blockNumber + 1n)
    throw new Error(
      "Mint needs two confirmations. Wait for another Sepolia block and retry.",
    );
  const nft = deployment.contracts.HamsterRunNFT;
  const mintedHere = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== nft.toLowerCase()) return false;
    try {
      const event = decodeEventLog({
        abi: nftAbi,
        data: log.data,
        topics: log.topics,
      });
      return (
        event.eventName === "Transfer" &&
        event.args.from.toLowerCase() === zeroAddress &&
        event.args.to.toLowerCase() === wallet.toLowerCase()
      );
    } catch {
      return false;
    }
  });
  if (!mintedHere)
    throw new Error("This receipt does not mint a HAM to the signing wallet.");
  // Also supports bundled smart-wallet transactions. An ownerMint alone never changes publicMinted.
  const check = (blockNumber) =>
    client.readContract({
      address: nft,
      abi: nftAbi,
      functionName: "publicMinted",
      args: [wallet],
      blockNumber,
    });
  const [before, after] = await Promise.all([
    check(receipt.blockNumber - 1n),
    check(receipt.blockNumber),
  ]);
  if (before || !after)
    throw new Error(
      "Invite credit requires this wallet’s first successful public mint, not an owner mint or transfer.",
    );
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw new Error(
      "The mint receipt changed in a chain reorganization. Retry after confirmations.",
    );
  return { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
}
