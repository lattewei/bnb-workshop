import { AAVE_BNB_POOL } from "./aave.js";
import { APPROVED_COMPTROLLERS } from "./venus.js";
import type {
  AllocationLeg,
  MarketSnapshot,
  ProfileRules,
  RejectedMarket,
  RiskProfile,
  UserConfig,
} from "./types.js";

export const PROFILE_RULES: Record<RiskProfile, Omit<ProfileRules, "minLiquidityUsd">> = {
  low: {
    maxSingleWeightPercent: 70,
    maxUtilization: 0.9,
    maxStableApyPercent: 15,
    minApyPercent: 0,
    cashBufferPercent: 20,
    preferApy: false,
    maxProtocolWeightPercent: 60,
  },
  moderate: {
    maxSingleWeightPercent: 80,
    maxUtilization: 0.92,
    maxStableApyPercent: 25,
    minApyPercent: 0,
    cashBufferPercent: 0,
    preferApy: false,
    maxProtocolWeightPercent: 70,
  },
  high: {
    maxSingleWeightPercent: 100,
    maxUtilization: 0.95,
    maxStableApyPercent: 40,
    minApyPercent: 0,
    cashBufferPercent: 0,
    preferApy: true,
    maxProtocolWeightPercent: 100,
  },
};

export const DEFAULT_MIN_LIQUIDITY: Record<RiskProfile, { mainnet: number; testnet: number }> = {
  low: { mainnet: 50_000, testnet: 1_000 },
  moderate: { mainnet: 10_000, testnet: 500 },
  high: { mainnet: 1_000, testnet: 100 },
};

export function rulesFor(user: UserConfig): ProfileRules {
  return { ...PROFILE_RULES[user.riskProfile], minLiquidityUsd: user.minLiquidityUsd };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function evaluateMarket(
  market: MarketSnapshot,
  user: UserConfig,
): string[] {
  const rules = rulesFor(user);
  const reasons: string[] = [];
  if (
    market.protocol !== "venus" &&
    market.protocol !== "aave" &&
    market.protocol !== "lista" &&
    market.protocol !== "kinza" &&
    market.protocol !== "pancake"
  ) {
    reasons.push("protocol_not_approved");
  }
  if (market.pairAssets && market.pairAssets.some((a) => !user.assets.includes(a))) {
    reasons.push("pair_assets_not_allowed");
  }
  if (!user.assets.includes(market.asset)) reasons.push("asset_not_allowed");
  if (!market.listed) reasons.push("market_not_listed");
  if (market.paused) reasons.push("market_paused");
  if (market.priceInvalid) reasons.push("oracle_price_invalid");
  if (!Number.isFinite(market.supplyApyPercent)) reasons.push("apy_unavailable");
  if (market.supplyApyPercent < rules.minApyPercent) reasons.push("apy_unavailable");
  if (market.supplyApyPercent > rules.maxStableApyPercent) {
    reasons.push("apy_unrealistic_for_stable");
  }
  if (market.liquidityUsd < rules.minLiquidityUsd) reasons.push("liquidity_insufficient");
  if (market.utilization > rules.maxUtilization) reasons.push("utilization_too_high");
  if (market.protocol === "venus" && !APPROVED_COMPTROLLERS.has(market.comptroller.toLowerCase())) {
    reasons.push("comptroller_not_whitelisted");
  }
  if (
    market.protocol === "aave" &&
    market.comptroller.toLowerCase() !== AAVE_BNB_POOL.toLowerCase()
  ) {
    reasons.push("aave_pool_not_whitelisted");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(market.vToken)) reasons.push("invalid_vtoken_address");
  if (!/^0x[a-fA-F0-9]{40}$/.test(market.underlying)) {
    reasons.push("invalid_underlying_address");
  }
  return reasons;
}

export function screenMarkets(
  markets: MarketSnapshot[],
  user: UserConfig,
): { accepted: MarketSnapshot[]; rejected: RejectedMarket[] } {
  const accepted: MarketSnapshot[] = [];
  const rejected: RejectedMarket[] = [];
  const bestByKey = new Map<string, MarketSnapshot>();

  for (const market of markets) {
    const reasons = evaluateMarket(market, user);
    if (reasons.length > 0) {
      rejected.push({ market, reasons });
      continue;
    }
    const key = `${market.protocol}:${market.asset}`;
    const prev = bestByKey.get(key);
    if (!prev || market.liquidityUsd > prev.liquidityUsd) {
      if (prev) rejected.push({ market: prev, reasons: ["superseded_by_deeper_market"] });
      bestByKey.set(key, market);
    } else {
      rejected.push({ market, reasons: ["superseded_by_deeper_market"] });
    }
  }

  for (const market of bestByKey.values()) accepted.push(market);
  return { accepted, rejected };
}

export function validateAllocation(
  legs: AllocationLeg[],
  user: UserConfig,
): string[] {
  const rules = rulesFor(user);
  const reasons: string[] = [];
  const totalUsd = round2(legs.reduce((s, l) => s + l.amountUsd, 0));
  const totalWeight = round2(legs.reduce((s, l) => s + l.weightPercent, 0));

  if (totalUsd > user.maxAllocationUsd + 0.01) reasons.push("allocation_exceeds_max");
  if (totalUsd > user.amountUsd + 0.01) reasons.push("allocation_exceeds_available");
  if (totalWeight > 100.01) reasons.push("weights_exceed_100");

  for (const leg of legs) {
    if (!user.assets.includes(leg.asset)) reasons.push(`asset_not_allowed:${leg.asset}`);
    if (
      leg.protocol !== "venus" &&
      leg.protocol !== "aave" &&
      leg.protocol !== "lista" &&
      leg.protocol !== "kinza" &&
      leg.protocol !== "pancake"
    ) {
      reasons.push(`protocol_not_approved:${leg.protocol}`);
    }
    if (leg.weightPercent > rules.maxSingleWeightPercent + 0.01) {
      reasons.push(`single_market_cap:${leg.asset}`);
    }
    if (leg.amountUsd < 0) reasons.push("negative_leg");
    if (!/^0x[a-fA-F0-9]{40}$/.test(leg.vToken)) reasons.push("invalid_vtoken_address");
  }

  const byProtocol = new Map<string, number>();
  for (const leg of legs) {
    byProtocol.set(leg.protocol, (byProtocol.get(leg.protocol) ?? 0) + leg.weightPercent);
  }
  for (const [protocol, weight] of byProtocol) {
    if (weight > rules.maxProtocolWeightPercent + 0.01) {
      reasons.push(`protocol_cap:${protocol}`);
    }
  }
  return reasons;
}
