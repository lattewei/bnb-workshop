import { rulesFor } from "./riskEngine.js";
import type { AllocationLeg, MarketSnapshot, UserConfig } from "./types.js";

const ESTIMATED_GAS_USD = 0.15;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function netApy(advertised: number, amountUsd: number): number {
  if (amountUsd <= 0) return 0;
  const drag = (ESTIMATED_GAS_USD / amountUsd) * 100;
  return round2(Math.max(0, advertised - drag));
}

function liquidityScore(market: MarketSnapshot): number {
  return market.liquidityUsd * (1 - market.utilization) * (1 + market.supplyApyPercent / 100);
}

function toLeg(market: MarketSnapshot, weightPercent: number, budget: number): AllocationLeg {
  const amountUsd = round2((budget * weightPercent) / 100);
  return {
    asset: market.asset,
    protocol: market.protocol,
    vToken: market.vToken,
    underlying: market.underlying,
    weightPercent: round2(weightPercent),
    amountUsd,
    advertisedApyPercent: round2(market.supplyApyPercent),
    netApyPercent: netApy(market.supplyApyPercent, amountUsd),
    liquidityUsd: round2(market.liquidityUsd),
    utilization: Math.round(market.utilization * 10000) / 10000,
  };
}

function capWeights(
  ranked: MarketSnapshot[],
  weights: number[],
  marketCap: number,
  protocolCap: number,
): number[] {
  const out = weights.map((w) => Math.min(w, marketCap));
  const protocols = [...new Set(ranked.map((m) => m.protocol))];
  for (const protocol of protocols) {
    const idxs = ranked.map((m, i) => (m.protocol === protocol ? i : -1)).filter((i) => i >= 0);
    const sum = idxs.reduce((s, i) => s + (out[i] ?? 0), 0);
    if (sum <= protocolCap) continue;
    const scale = protocolCap / sum;
    for (const i of idxs) out[i] = (out[i] ?? 0) * scale;
  }
  const used = out.reduce((s, w) => s + w, 0);
  if (used < 99.9 && used > 0) {
    const room = out.map((w, i) => {
      const protoSum = ranked.reduce(
        (s, m, j) => (m.protocol === ranked[i]!.protocol ? s + (out[j] ?? 0) : s),
        0,
      );
      return Math.min(marketCap - w, protocolCap - protoSum);
    });
    const roomSum = room.reduce((s, r) => s + Math.max(0, r), 0);
    const leftover = 100 - used;
    if (roomSum > 0) {
      for (let i = 0; i < out.length; i += 1) {
        const add = leftover * (Math.max(0, room[i] ?? 0) / roomSum);
        out[i] = Math.min(marketCap, (out[i] ?? 0) + add);
      }
    }
  }
  return out;
}

export function allocate(
  markets: MarketSnapshot[],
  user: UserConfig,
): { legs: AllocationLeg[]; cashUsd: number; portfolioNetApyPercent: number | null } {
  const rules = rulesFor(user);
  const budget =
    Math.min(user.amountUsd, user.maxAllocationUsd) * (1 - rules.cashBufferPercent / 100);
  if (markets.length === 0 || budget <= 0) {
    return { legs: [], cashUsd: round2(user.amountUsd), portfolioNetApyPercent: null };
  }

  let ranked = [...markets];
  if (rules.preferApy) {
    ranked.sort((a, b) => b.supplyApyPercent - a.supplyApyPercent || b.liquidityUsd - a.liquidityUsd);
    const winner = ranked[0]!;
    const legs = [toLeg(winner, Math.min(100, rules.maxSingleWeightPercent), budget)].filter(
      (l) => l.amountUsd > 0,
    );
    const allocated = round2(legs.reduce((s, l) => s + l.amountUsd, 0));
    return {
      legs,
      cashUsd: round2(user.amountUsd - allocated),
      portfolioNetApyPercent: legs[0]?.netApyPercent ?? null,
    };
  }

  ranked.sort((a, b) => liquidityScore(b) - liquidityScore(a));
  const raw = ranked.map((m) => liquidityScore(m));
  const rawSum = raw.reduce((s, n) => s + n, 0);
  const uncapped = ranked.map((_, i) => (rawSum > 0 ? (raw[i]! / rawSum) * 100 : 0));
  const weights = capWeights(
    ranked,
    uncapped,
    rules.maxSingleWeightPercent,
    rules.maxProtocolWeightPercent,
  );

  const legs = ranked
    .map((market, i) => toLeg(market, weights[i] ?? 0, budget))
    .filter((leg) => leg.amountUsd > 0);
  const allocated = round2(legs.reduce((s, l) => s + l.amountUsd, 0));
  const cashUsd = round2(user.amountUsd - allocated);
  const portfolioNetApyPercent =
    allocated > 0
      ? round2(legs.reduce((s, l) => s + l.netApyPercent * (l.amountUsd / allocated), 0))
      : null;
  return { legs, cashUsd, portfolioNetApyPercent };
}
