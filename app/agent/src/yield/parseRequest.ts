import { parseAddress } from "./holdings.js";
import { DEFAULT_MIN_LIQUIDITY } from "./riskEngine.js";
import {
  ALLOWED_ASSETS,
  RISK_PROFILES,
  type AllowedAsset,
  type RiskProfile,
  type UserConfig,
} from "./types.js";

const DEFAULT_AMOUNT = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "oui"].includes(v)) return true;
    if (["false", "0", "no", "non"].includes(v)) return false;
  }
  return null;
}

function parseAssets(value: unknown): AllowedAsset[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s/]+/)
      : null;
  if (!raw) return null;
  const out: AllowedAsset[] = [];
  for (const item of raw) {
    const token = String(item).trim().toUpperCase().replace(/^V/, "");
    if ((ALLOWED_ASSETS as readonly string[]).includes(token) && !out.includes(token as AllowedAsset)) {
      out.push(token as AllowedAsset);
    }
  }
  return out.length > 0 ? out : null;
}

function parseProfile(value: unknown): RiskProfile | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  const aliases: Record<string, RiskProfile> = {
    low: "low",
    faible: "low",
    conservative: "low",
    conservateur: "low",
    moderate: "moderate",
    moyen: "moderate",
    balanced: "moderate",
    equilibre: "moderate",
    "équilibré": "moderate",
    high: "high",
    haut: "high",
    dynamic: "high",
    dynamique: "high",
  };
  return aliases[key] ?? (RISK_PROFILES.includes(key as RiskProfile) ? (key as RiskProfile) : null);
}

function extractJsonBlobs(prompt: string): Record<string, unknown>[] {
  const blobs: Record<string, unknown>[] = [];
  const matches = prompt.match(/\{[\s\S]*\}/g) ?? [];
  for (const match of matches) {
    try {
      const parsed: unknown = JSON.parse(match);
      if (isRecord(parsed)) blobs.push(parsed);
    } catch {
      // ignore
    }
  }
  return blobs;
}

function flatten(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };
  if (isRecord(source.task)) Object.assign(out, source.task);
  if (isRecord(source.terms)) Object.assign(out, source.terms);
  if (typeof source.task === "string") {
    try {
      const nested: unknown = JSON.parse(source.task);
      if (isRecord(nested)) Object.assign(out, flatten(nested));
    } catch {
      out.task_text = source.task;
    }
  }
  return out;
}

export function parseUserConfig(prompt: string, network: string): UserConfig {
  const fields: Record<string, unknown> = {};
  for (const blob of extractJsonBlobs(prompt)) Object.assign(fields, flatten(blob));

  const amountUsd =
    num(fields.amountUsd) ??
    num(fields.amount) ??
    num(fields.available_amount) ??
    num(fields.capital) ??
    DEFAULT_AMOUNT;

  const assets =
    parseAssets(fields.assets) ??
    parseAssets(fields.accepted_assets) ??
    parseAssets(fields.tokens) ??
    [...ALLOWED_ASSETS];

  const parsed = parseProfile(fields.riskProfile) ??
    parseProfile(fields.risk_profile) ??
    parseProfile(fields.profile);
  const requestedProfile = parsed ?? "low";
  const profileForced = parsed === null;
  const riskProfile = requestedProfile;

  const maxAllocationUsd = Math.min(
    amountUsd,
    num(fields.maxAllocationUsd) ??
      num(fields.max_allocation) ??
      num(fields.maxAllocation) ??
      amountUsd,
  );

  const defaults = DEFAULT_MIN_LIQUIDITY[riskProfile];
  const defaultMin = network === "bsc-mainnet" ? defaults.mainnet : defaults.testnet;
  const minLiquidityUsd =
    num(fields.minLiquidityUsd) ??
    num(fields.min_liquidity) ??
    num(fields.minLiquidity) ??
    defaultMin;

  const clientAddress =
    parseAddress(fields.wallet) ??
    parseAddress(fields.address) ??
    parseAddress(fields.clientAddress) ??
    parseAddress(fields.walletAddress) ??
    parseAddress(prompt.match(/0x[a-fA-F0-9]{40}/)?.[0]);

  const wantExecute =
    clientAddress === null &&
    process.env.YIELD_EXECUTE !== "0" &&
    (bool(fields.execute) ?? bool(fields.wantExecute) ?? true);

  return {
    amountUsd,
    assets,
    riskProfile,
    requestedProfile,
    profileForced,
    maxAllocationUsd,
    minLiquidityUsd,
    wantExecute,
    halted: process.env.YIELD_HALT === "1",
    clientAddress,
  };
}
