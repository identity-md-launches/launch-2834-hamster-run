import type pinned from "./deployment.json";

type Handoff = typeof pinned & {
  version: number;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
};
// Loaded before chain.ts and App, so every reader/wallet uses the same handoff.
export let deployment: Handoff;
export async function loadDeployment() {
  const response = await fetch("./imd-deployment.json", {
    signal: AbortSignal.timeout(10_000),
    cache: "no-cache",
  });
  if (!response.ok) throw new Error("Deployment handoff unavailable.");
  const data: Handoff = await response.json();
  if (
    data.version !== 1 ||
    data.chainId !== 11155111 ||
    data.network?.chainId !== data.chainId ||
    !data.network.testnet ||
    !data.network.rpcUrls?.length ||
    !data.contracts ||
    Object.values(data.contracts).some((a) => !/^0x[\da-f]{40}$/i.test(a))
  )
    throw new Error("Invalid Sepolia deployment handoff.");
  deployment = data;
}
