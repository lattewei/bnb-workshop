import { loadLlamaPools, stableAsset } from "./llama.js";
import type { AllowedAsset, MarketSnapshot } from "./types.js";

export const AAVE_BNB_POOL = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB";
export const AAVE_BNB_CHAIN_ID = 56;

export const AAVE_BNB_RESERVES: Record<
  AllowedAsset,
  { underlying: string; aToken: string }
> = {
  USDC: {
    underlying: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    aToken: "0x00901a076785e0906d1028c7d6372d247bec7d61",
  },
  USDT: {
    underlying: "0x55d398326f99059fF775485246999027B3197955",
    aToken: "0xa9251ca9DE909CB71783723713B21E4233fbf1B1",
  },
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export async function fetchAaveMarkets(
  preferredChainId: number,
  signal?: AbortSignal,
): Promise<{
  markets: MarketSnapshot[];
  source: string;
  sourceChainId: number | null;
}> {
  if (preferredChainId !== 56 && preferredChainId !== 97) {
    return { markets: [], source: "aave-skipped", sourceChainId: null };
  }

  const rows = await loadLlamaPools(signal);
  const byAsset = new Map<AllowedAsset, MarketSnapshot>();
  for (const row of rows) {
    if (String(row.chain ?? "") !== "BSC") continue;
    if (String(row.project ?? "").toLowerCase() !== "aave-v3") continue;
    const asset = stableAsset(String(row.symbol ?? ""));
    if (!asset) continue;
    const apy = num(row.apyBase) ?? num(row.apy);
    const tvl = num(row.tvlUsd);
    if (apy === null || tvl === null) continue;
    const reserve = AAVE_BNB_RESERVES[asset];
    const snapshot: MarketSnapshot = {
      protocol: "aave",
      chainId: AAVE_BNB_CHAIN_ID,
      asset,
      symbol: `a${asset}`,
      vToken: reserve.aToken,
      underlying: reserve.underlying,
      comptroller: AAVE_BNB_POOL,
      supplyApyPercent: apy,
      rewardApyPercent: num(row.apyReward) ?? 0,
      liquidityUsd: tvl,
      utilization: 0,
      listed: true,
      paused: false,
      priceInvalid: false,
      withdrawal: "instant (Aave V3 supply; no lock-up)",
    };
    const prev = byAsset.get(asset);
    if (!prev || snapshot.liquidityUsd > prev.liquidityUsd) byAsset.set(asset, snapshot);
  }

  const markets = [...byAsset.values()];
  return {
    markets,
    source: "https://yields.llama.fi/pools (Aave V3 BNB)",
    sourceChainId: markets.length > 0 ? AAVE_BNB_CHAIN_ID : null,
  };
}
