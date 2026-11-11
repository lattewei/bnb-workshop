import type { AllocationLeg, SimulatedStep, YieldReport } from "./types.js";

export function emptyExecution(): YieldReport["execution"] {
  return { attempted: false, broadcast: false, skippedReason: null, steps: [] };
}

export function simulateAllocation(legs: AllocationLeg[]): YieldReport["simulation"] {
  const steps: SimulatedStep[] = [];
  for (const leg of legs) {
    steps.push({
      op: "approve",
      protocol: "venus",
      token: leg.underlying,
      spender: leg.vToken,
      amountUsd: leg.amountUsd,
      signed: false,
    });
    steps.push({
      op: "mint",
      protocol: "venus",
      token: leg.vToken,
      amountUsd: leg.amountUsd,
      signed: false,
    });
  }
  return {
    mode: "plan",
    steps,
    notes: [
      "Plan déterministe produit par le Risk Engine.",
      "Broadcast seulement si tokens déjà sur le wallet agent, chaîne alignée, et Risk Engine OK.",
      "L'IA ne signe aucune transaction.",
    ],
  };
}
