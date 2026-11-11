import { toRaw } from "@bnbagent/studio-runtime/networks";
import { encodeFunctionData } from "viem";
import { AAVE_BNB_POOL } from "./aave.js";
import type { AllocationLeg, ClientAction } from "./types.js";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const VTOKEN_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const AAVE_SUPPLY_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

function asAddr(value: string): `0x${string}` {
  return value as `0x${string}`;
}

function uiFor(leg: AllocationLeg): string {
  if (leg.protocol === "venus") {
    return `https://app.venus.io/#/core-pool/market/${leg.vToken}?chainId=56`;
  }
  if (leg.protocol === "aave") {
    return `https://app.aave.com/reserve-overview/?underlyingAsset=${leg.underlying.toLowerCase()}&marketName=proto_bnb_v3`;
  }
  if (leg.protocol === "lista") return "https://lista.org/";
  if (leg.protocol === "kinza") return "https://kinza.finance/";
  return "https://pancakeswap.finance/liquidity";
}

export function buildClientActions(
  legs: AllocationLeg[],
  client: `0x${string}`,
): ClientAction[] {
  const actions: ClientAction[] = [];
  for (const leg of legs) {
    if (leg.amountUsd <= 0) continue;
    const amount = toRaw(leg.amountUsd.toFixed(2), 18);
    const title = `${leg.protocol} ${leg.asset} · ${leg.amountUsd} USD`;
    if (leg.protocol === "venus") {
      actions.push({
        title: `1. Approuver ${leg.asset} → Venus`,
        protocol: leg.protocol,
        asset: leg.asset,
        to: leg.underlying,
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [asAddr(leg.vToken), amount],
        }),
        amountUsd: leg.amountUsd,
        signed: false,
        url: uiFor(leg),
      });
      actions.push({
        title: `2. Déposer ${leg.asset} sur Venus`,
        protocol: leg.protocol,
        asset: leg.asset,
        to: leg.vToken,
        data: encodeFunctionData({
          abi: VTOKEN_MINT_ABI,
          functionName: "mint",
          args: [amount],
        }),
        amountUsd: leg.amountUsd,
        signed: false,
        url: uiFor(leg),
      });
      continue;
    }
    if (leg.protocol === "aave") {
      actions.push({
        title: `1. Approuver ${leg.asset} → Aave`,
        protocol: leg.protocol,
        asset: leg.asset,
        to: leg.underlying,
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [asAddr(AAVE_BNB_POOL), amount],
        }),
        amountUsd: leg.amountUsd,
        signed: false,
        url: uiFor(leg),
      });
      actions.push({
        title: `2. Supply ${leg.asset} sur Aave`,
        protocol: leg.protocol,
        asset: leg.asset,
        to: AAVE_BNB_POOL,
        data: encodeFunctionData({
          abi: AAVE_SUPPLY_ABI,
          functionName: "supply",
          args: [asAddr(leg.underlying), amount, client, 0],
        }),
        amountUsd: leg.amountUsd,
        signed: false,
        url: uiFor(leg),
      });
      continue;
    }
    actions.push({
      title,
      protocol: leg.protocol,
      asset: leg.asset,
      to: null,
      data: null,
      amountUsd: leg.amountUsd,
      signed: false,
      url: uiFor(leg),
    });
  }
  return actions;
}
