import { getNetwork } from "@bnbagent/studio-runtime/networks";
import { createPublicClient, http } from "viem";
import type { AllowedAsset, Holdings } from "./types.js";

const TOKENS: Record<AllowedAsset, `0x${string}`> = {
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
};

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export function parseAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as `0x${string}`;
}

export async function readHoldings(
  address: `0x${string}`,
  assets: AllowedAsset[],
): Promise<Holdings> {
  const info = getNetwork("bsc-mainnet");
  const client = createPublicClient({ transport: http(info.rpcUrl) });
  const balances: Record<AllowedAsset, number> = { USDC: 0, USDT: 0 };
  for (const asset of assets) {
    const token = TOKENS[asset];
    const [raw, decimals] = await Promise.all([
      client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      }),
      client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);
    balances[asset] = Number(raw) / 10 ** Number(decimals);
  }
  const totalUsd = balances.USDC + balances.USDT;
  return {
    chainId: 56,
    address,
    usdc: Math.round(balances.USDC * 100) / 100,
    usdt: Math.round(balances.USDT * 100) / 100,
    totalUsd: Math.round(totalUsd * 100) / 100,
  };
}
