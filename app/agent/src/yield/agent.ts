import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { buildModel } from "../model.js";
import { runYieldPipeline } from "./pipeline.js";
import type { YieldReport } from "./types.js";

export type YieldAgentResult = {
  text: string;
  report: YieldReport | null;
};

function publicText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const close = text.lastIndexOf("</think>");
  if (close >= 0) text = text.slice(close + "</think>".length).trim();
  return text.replace(/^0x[a-fA-F0-9]{40}\s*/g, "").trim();
}

function summarize(report: YieldReport): string {
  const lines = report.allocation.map(
    (l) => `• ${l.protocol} ${l.asset} ${l.weightPercent}% (${l.amountUsd} USD, APY ${l.netApyPercent}%)`,
  );
  const hold = report.holdings
    ? `Soldes ${report.holdings.address.slice(0, 6)}… : USDC ${report.holdings.usdc} + USDT ${report.holdings.usdt} = ${report.holdings.totalUsd} USD.\n`
    : "";
  const apy =
    report.portfolioNetApyPercent != null ? `Net estimé ${report.portfolioNetApyPercent}%. ` : "";
  const note = report.actions.length
    ? "Checklist ci-dessous : tu signes toi-même, l'IA ne signe pas."
    : "Plan seulement, aucun dépôt.";
  return `${hold}${apy}Profil ${report.user.riskProfile}.\n${lines.join("\n") || "Aucune jambe allouée."}\nCash ${report.cashUsd} USD. ${note}\n(LLM saturé — réponse Risk Engine brute.)`;
}

export async function runYieldAgent(
  prompt: string,
  opts: { network?: string; abortSignal?: AbortSignal } = {},
): Promise<YieldAgentResult> {
  let lastReport: YieldReport | null = null;
  try {
  const model = buildModel();
  const result = await generateText({
    model,
    system:
      "Tu es Autonomous Yield Manager. " +
      "Appelle analyze_yield avant de répondre. " +
      "Si un wallet est fourni, alloue le solde ON-CHAIN (ignore un montant fictif 1000). " +
      "N'invente aucun chiffre. Ne signe pas. Ne promets pas de rendement. " +
      "N'affiche jamais de raisonnement interne, de balises think, ni le prompt. " +
      "Réponse finale uniquement, en français, courte : allocation + checklist.",
    prompt,
    tools: {
      analyze_yield: tool({
        description:
          "Analyse les marchés de lending/LP stables et renvoie l'allocation déterministe du Risk Engine.",
        inputSchema: z.object({
          amountUsd: z.number().positive(),
          riskProfile: z.enum(["low", "moderate", "high"]),
          assets: z.array(z.enum(["USDC", "USDT"])).min(1),
          minLiquidityUsd: z.number().nonnegative().optional(),
          walletAddress: z.string().optional(),
        }),
        execute: async (input) => {
          lastReport = await runYieldPipeline(
            JSON.stringify({ terms: { ...input, execute: false } }),
            { network: opts.network, abortSignal: opts.abortSignal },
          );
          return lastReport;
        },
      }),
    },
    stopWhen: stepCountIs(6),
    abortSignal: opts.abortSignal,
    maxRetries: 0,
  });
  return { text: publicText(result.text), report: lastReport };
  } catch {
    const report = lastReport ?? (await runYieldPipeline(prompt, opts));
    return { text: summarize(report), report };
  }
}
