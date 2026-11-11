import type { AllowedAsset, ApprovedProtocol, MarketSnapshot } from "./types.js";

const LLAMA_POOLS_URL = "https://yields.llama.fi/pools";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const UNKNOWN = "0x0000000000000000000000000000000000000001";

type LlamaRow = Record<string, unknown>;

const PROJECTS: { protocol: ApprovedProtocol; slugs: string[]; pair: boolean; withdrawal: string }[] = [
  {
    protocol: "aave",
    slugs: ["aave-v3"],
    pair: false,
    withdrawal: "instant (Aave V3 supply)",
  },
  {
    protocol: "lista",
    slugs: ["lista-lending", "lista-dao", "lisalend", "helio-protocol", "lista"],
    pair: false,
    withdrawal: "instant (Lista lending)",
  },
  {
    protocol: "kinza",
    slugs: ["kinza", "kinza-finance"],
    pair: false,
    withdrawal: "instant (Kinza supply)",
  },
  {
    protocol: "pancake",
    slugs: ["pancakeswap-stableswap", "pancakeswap-amm", "pancakeswap"],
    pair: true,
    withdrawal: "LP stable (PancakeSwap; pas de lock)",
  },
];

let inflight: Promise<LlamaRow[]> | null = null;

function isRecord(value: unknown): value is LlamaRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function addr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
}

export function stableAsset(symbol: string): AllowedAsset | null {
  const upper = symbol.trim().toUpperCase().replace(/\s+/g, "");
  if (upper === "USDC" || upper.endsWith("USDC")) return "USDC";
  if (upper === "USDT" || upper.endsWith("USDT")) return "USDT";
  return null;
}

export function isUsdcUsdtPair(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase().replace(/\s+/g, "");
  return (
    upper.includes("USDT") &&
    upper.includes("USDC") &&
    !upper.includes("ETH") &&
    !upper.includes("BNB") &&
    !upper.includes("BTC")
  );
}

export async function loadLlamaPools(signal?: AbortSignal): Promise<LlamaRow[]> {
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(LLAMA_POOLS_URL, {
        signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Llama yields HTTP ${res.status}`);
      const body: unknown = await res.json();
      const rows = isRecord(body) && Array.isArray(body.data) ? body.data : [];
      return rows.filter(isRecord);
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function matchProtocol(project: string): (typeof PROJECTS)[number] | null {
  const slug = project.toLowerCase();
  return PROJECTS.find((p) => p.slugs.includes(slug) || p.slugs.some((s) => slug.includes(s))) ?? null;
}

export async function fetchLlamaMarkets(
  preferredChainId: number,
  signal?: AbortSignal,
): Promise<{
  markets: MarketSnapshot[];
  source: string;
  sourceChainId: number | null;
}> {
  if (preferredChainId !== 56 && preferredChainId !== 97) {
    return { markets: [], source: "llama-skipped", sourceChainId: null };
  }
  const rows = await loadLlamaPools(signal);
  const best = new Map<string, MarketSnapshot>();

  for (const row of rows) {
    if (String(row.chain ?? "") !== "BSC") continue;
    const spec = matchProtocol(String(row.project ?? ""));
    if (!spec) continue;
    const symbol = String(row.symbol ?? "");
    if (spec.protocol === "aave") continue;
    const pair = isUsdcUsdtPair(symbol);
    if (spec.protocol === "pancake" && !pair) continue;
    if (pair && !spec.pair) continue;
    const asset = pair ? "USDC" : stableAsset(symbol);
    if (!asset) continue;
    const apy = num(row.apyBase) ?? num(row.apy);
    const tvl = num(row.tvlUsd);
    if (apy === null || tvl === null) continue;

    const tokens = Array.isArray(row.underlyingTokens) ? row.underlyingTokens : [];
    const vault = addr(row.pool) ?? addr(tokens[0]) ?? UNKNOWN;
    const underlying = asset === "USDT" ? BSC_USDT : BSC_USDC;
    const key = `${spec.protocol}:${pair ? "USDT-USDC" : asset}`;
    const snapshot: MarketSnapshot = {
      protocol: spec.protocol,
      chainId: 56,
      asset,
      symbol: pair ? "USDT-USDC" : symbol,
      vToken: vault,
      underlying,
      comptroller: vault,
      supplyApyPercent: apy,
      rewardApyPercent: num(row.apyReward) ?? 0,
      liquidityUsd: tvl,
      utilization: 0,
      listed: true,
      paused: false,
      priceInvalid: false,
      withdrawal: spec.withdrawal,
      pairAssets: pair ? ["USDC", "USDT"] : undefined,
    };
    const prev = best.get(key);
    if (!prev || snapshot.liquidityUsd > prev.liquidityUsd) best.set(key, snapshot);
  }

  const markets = [...best.values()];
  return {
    markets,
    source: "https://yields.llama.fi/pools",
    sourceChainId: markets.length > 0 ? 56 : null,
  };
}
