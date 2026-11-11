import {
  ALLOWED_ASSETS,
  type AllowedAsset,
  type MarketSnapshot,
} from "./types.js";

const VENUS_MARKETS_URL = "https://api.venus.io/markets";
const PAGE_SIZE = 50;
const MAX_PAGES = 8;

export const APPROVED_COMPTROLLERS = new Set(
  [
    "0xfd36e2c2a6789db23113685031d7f16329158384",
    "0xfd36e2c2a6789db23113685031d7f1639756e629",
    "0x94d1820b2d1c7c7452a345a24876ed8d5b3b1d2e",
  ].map((a) => a.toLowerCase()),
);

type VenusMarket = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function addr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asAsset(symbol: string): AllowedAsset | null {
  const normalized = symbol.trim().toUpperCase().replace(/^V/, "");
  return (ALLOWED_ASSETS as readonly string[]).includes(normalized)
    ? (normalized as AllowedAsset)
    : null;
}

async function fetchPage(
  page: number,
  signal?: AbortSignal,
): Promise<{ total: number; result: VenusMarket[] }> {
  const url = `${VENUS_MARKETS_URL}?limit=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Venus API HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  if (!isRecord(body) || !Array.isArray(body.result)) {
    throw new Error("Venus API payload invalid");
  }
  return {
    total: num(body.total) ?? body.result.length,
    result: body.result.filter(isRecord),
  };
}

function toSnapshot(raw: VenusMarket): MarketSnapshot | null {
  const underlyingSymbol = String(raw.underlyingSymbol ?? "");
  const asset = asAsset(underlyingSymbol);
  if (!asset) return null;
  const chainId = num(raw.chainId);
  const vToken = addr(raw.address);
  const underlying = addr(raw.underlyingAddress);
  const comptroller = addr(raw.poolComptrollerAddress);
  if (chainId === null || !vToken || !underlying || !comptroller) return null;

  const supplyApyDecimal = num(raw.supplyApyDecimal);
  const supplyApy = num(raw.supplyApy);
  const supplyApyPercent =
    supplyApyDecimal !== null
      ? supplyApyDecimal * 100
      : supplyApy !== null
        ? supplyApy
        : null;
  if (supplyApyPercent === null) return null;

  const rewardDecimal = num(raw.supplyXvsApy);
  const rewardApyPercent =
    rewardDecimal !== null
      ? rewardDecimal > 1
        ? rewardDecimal
        : rewardDecimal * 100
      : 0;

  const liquidityCents = num(raw.liquidityCents);
  const liquidityUsd =
    liquidityCents !== null ? liquidityCents / 100 : (num(raw.liquidityUsd) ?? 0);

  const borrowCents = num(raw.totalBorrowCents) ?? 0;
  const supplyCents =
    num(raw.totalSupplyUnderlyingCents) ??
    borrowCents + (liquidityCents !== null ? liquidityCents : liquidityUsd * 100);
  const utilization =
    supplyCents > 0 ? Math.min(1, Math.max(0, borrowCents / supplyCents)) : 0;

  return {
    protocol: "venus",
    chainId,
    asset,
    symbol: String(raw.symbol ?? `v${asset}`),
    vToken,
    underlying,
    comptroller,
    supplyApyPercent,
    rewardApyPercent,
    liquidityUsd,
    utilization,
    listed: raw.isListed === true,
    paused: (num(raw.pausedActionsBitmap) ?? 0) !== 0,
    priceInvalid: raw.isPriceInvalid === true,
    withdrawal: "instant (Venus supply; no lock-up advertised)",
  };
}

export async function fetchVenusMarkets(
  preferredChainId: number,
  signal?: AbortSignal,
): Promise<{
  markets: MarketSnapshot[];
  source: string;
  sourceChainId: number | null;
}> {
  const collected: VenusMarket[] = [];
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && collected.length < total; page += 1) {
    const batch = await fetchPage(page, signal);
    total = batch.total;
    collected.push(...batch.result);
    if (batch.result.length === 0) break;
  }

  const snapshots = collected
    .map(toSnapshot)
    .filter((m): m is MarketSnapshot => m !== null);

  const preferred = snapshots.filter((m) => m.chainId === preferredChainId);
  if (preferred.length > 0) {
    return {
      markets: preferred,
      source: "https://api.venus.io/markets",
      sourceChainId: preferredChainId,
    };
  }

  const mainnet = snapshots.filter((m) => m.chainId === 56);
  if (mainnet.length > 0) {
    return {
      markets: mainnet,
      source: "https://api.venus.io/markets (BSC mainnet reference — testnet markets unavailable)",
      sourceChainId: 56,
    };
  }

  return { markets: [], source: "https://api.venus.io/markets", sourceChainId: null };
}
