import { buildClientActions } from "./actions.js";
import { allocate } from "./allocator.js";
import { executeAllocation } from "./executor.js";
import { readHoldings } from "./holdings.js";
import { parseUserConfig } from "./parseRequest.js";
import { screenMarkets, validateAllocation } from "./riskEngine.js";
import { emptyExecution, simulateAllocation } from "./simulator.js";
import type { ExecutionResult, Holdings, YieldReport } from "./types.js";
import { fetchAaveMarkets } from "./aave.js";
import { fetchLlamaMarkets } from "./llama.js";
import { fetchVenusMarkets } from "./venus.js";

const DISCLAIMERS = [
  "Les APY (Venus, Aave, Lista, Kinza, Pancake) sont variables — pas un rendement garanti.",
  "Les récompenses XVS ne sont pas incluses dans le rendement net.",
  "Si une adresse est fournie, l'allocation suit les soldes BSC mainnet. Le client signe lui-même.",
  "L'IA ne signe pas. Risk Engine + exécuteur whitelisté seulement.",
  "Pas de levier. Pas de rééquilibrage automatique.",
];

function emptyReport(
  partial: Partial<YieldReport> & Pick<YieldReport, "user" | "network">,
): YieldReport {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    marketSource: "none",
    sourceChainId: null,
    opportunities: [],
    rejected: [],
    allocation: [],
    cashUsd: partial.user.amountUsd,
    portfolioNetApyPercent: null,
    simulation: simulateAllocation([]),
    execution: emptyExecution(),
    holdings: null,
    actions: [],
    risk: { blocked: true, reasons: [] },
    disclaimers: DISCLAIMERS,
    log: [],
    ...partial,
  };
}

export async function runYieldPipeline(
  prompt: string,
  opts: { network?: string; abortSignal?: AbortSignal } = {},
): Promise<YieldReport> {
  const network = opts.network ?? "bsc-testnet";
  const user = parseUserConfig(prompt, network);
  const log: string[] = [];

  if (user.halted) {
    log.push("operations_suspended");
    return emptyReport({
      user,
      network,
      risk: { blocked: true, reasons: ["operations_suspended"] },
      log,
    });
  }

  if (user.profileForced) log.push("profile_defaulted:low");
  log.push(`profile:${user.riskProfile}`);

  let holdings: Holdings | null = null;
  if (user.clientAddress) {
    try {
      holdings = await readHoldings(user.clientAddress, user.assets);
      log.push(`holdings:${holdings.totalUsd}:usdc:${holdings.usdc}:usdt:${holdings.usdt}`);
      if (holdings.totalUsd > 0) {
        user.amountUsd = holdings.totalUsd;
        user.maxAllocationUsd = holdings.totalUsd;
      } else {
        log.push("holdings_empty");
      }
    } catch (error) {
      log.push(
        `holdings_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const preferredChainId = network === "bsc-mainnet" ? 56 : 97;
  const [venusResult, aaveResult, llamaResult] = await Promise.allSettled([
    fetchVenusMarkets(preferredChainId, opts.abortSignal),
    fetchAaveMarkets(preferredChainId, opts.abortSignal),
    fetchLlamaMarkets(preferredChainId, opts.abortSignal),
  ]);

  const venus = venusResult.status === "fulfilled" ? venusResult.value : null;
  const aave = aaveResult.status === "fulfilled" ? aaveResult.value : null;
  const llama = llamaResult.status === "fulfilled" ? llamaResult.value : null;
  if (venusResult.status === "rejected") {
    log.push(`venus_unavailable:${venusResult.reason instanceof Error ? venusResult.reason.message : String(venusResult.reason)}`);
  }
  if (aaveResult.status === "rejected") {
    log.push(`aave_unavailable:${aaveResult.reason instanceof Error ? aaveResult.reason.message : String(aaveResult.reason)}`);
  }
  if (llamaResult.status === "rejected") {
    log.push(`llama_unavailable:${llamaResult.reason instanceof Error ? llamaResult.reason.message : String(llamaResult.reason)}`);
  }

  const markets = [...(venus?.markets ?? []), ...(aave?.markets ?? []), ...(llama?.markets ?? [])];
  const sources = [venus?.source, aave?.source, llama?.source].filter(Boolean).join(" + ");
  const sourceChainId = venus?.sourceChainId ?? aave?.sourceChainId ?? llama?.sourceChainId ?? null;
  log.push(
    `markets_fetched:${markets.length}:venus:${venus?.markets.length ?? 0}:aave:${aave?.markets.length ?? 0}:llama:${llama?.markets.length ?? 0}`,
  );

  if (markets.length === 0) {
    log.push("no_usdc_usdt_markets");
    return emptyReport({
      user,
      network,
      marketSource: sources || "unavailable",
      sourceChainId,
      holdings,
      risk: { blocked: true, reasons: ["market_data_unavailable"] },
      log,
    });
  }

  const screened = screenMarkets(markets, user);
  log.push(`accepted:${screened.accepted.length}:rejected:${screened.rejected.length}`);

  const plan = allocate(screened.accepted, user);
  const allocationErrors = validateAllocation(plan.legs, user);
  if (allocationErrors.length > 0) {
    log.push(`risk_blocked:${allocationErrors.join(",")}`);
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      network,
      marketSource: sources,
      sourceChainId,
      user,
      opportunities: screened.accepted,
      rejected: screened.rejected,
      allocation: [],
      cashUsd: user.amountUsd,
      portfolioNetApyPercent: null,
      simulation: simulateAllocation([]),
      execution: emptyExecution(),
      holdings,
      actions: [],
      risk: { blocked: true, reasons: allocationErrors },
      disclaimers: DISCLAIMERS,
      log,
    };
  }

  log.push(
    plan.legs.length === 0
      ? "no_eligible_allocation"
      : `allocated:${plan.legs.map((l) => `${l.protocol}:${l.asset}:${l.weightPercent}%`).join(",")}`,
  );

  const actions =
    user.clientAddress && plan.legs.length > 0
      ? buildClientActions(plan.legs, user.clientAddress)
      : [];

  let execution: ExecutionResult = emptyExecution();
  if (plan.legs.length > 0 && user.wantExecute && !user.clientAddress) {
    execution = await executeAllocation(plan.legs, user, {
      network,
      sourceChainId,
    });
    log.push(
      execution.broadcast
        ? `executed:${execution.steps.filter((s) => s.status === "sent").length}`
        : `execute_skipped:${execution.skippedReason ?? "unknown"}`,
    );
  } else if (!user.wantExecute) {
    execution = { ...emptyExecution(), skippedReason: "execute_disabled" };
  }

  return {
    ok: plan.legs.length > 0,
    generatedAt: new Date().toISOString(),
    network,
      marketSource: sources,
      sourceChainId,
    user,
    opportunities: screened.accepted,
    rejected: screened.rejected,
    allocation: plan.legs,
    cashUsd: plan.cashUsd,
    portfolioNetApyPercent: plan.portfolioNetApyPercent,
    simulation: simulateAllocation(plan.legs),
    execution,
    holdings,
    actions,
    risk: {
      blocked: plan.legs.length === 0,
      reasons: plan.legs.length === 0 ? ["no_market_passed_risk_engine"] : [],
    },
    disclaimers: DISCLAIMERS,
    log,
  };
}

export function formatYieldReport(report: YieldReport): string {
  return JSON.stringify(report, null, 2);
}
