import { getNetwork, toRaw } from "@bnbagent/studio-runtime/networks";
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import { createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { executeWhitelistedCall } from "../signing.js";
import { AAVE_BNB_POOL } from "./aave.js";
import { emptyExecution } from "./simulator.js";
import type {
  AllocationLeg,
  ExecutionResult,
  ExecutionStep,
  UserConfig,
} from "./types.js";

const MAX_EXECUTE_USD = 10_000;

export const PROTOCOL_ALLOWLIST = new Set(
  [
    "0xfd5840cd36d94d7229439859c0112a4185bc0255",
    "0xeca88125a5adbe82614ffc12d0db554e2e2867c8",
    "0x55d398326f99059ff775485246999027b3197955",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    AAVE_BNB_POOL,
    "0x00901a076785e0906d1028c7d6372d247bec7d61",
    "0xa9251ca9DE909CB71783723713B21E4233fbf1B1",
  ].map((a) => a.toLowerCase()),
);

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
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

const VTOKEN_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const AAVE_POOL_ABI = [
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

export async function executeAllocation(
  legs: AllocationLeg[],
  user: UserConfig,
  opts: { network: string; sourceChainId: number | null },
): Promise<ExecutionResult> {
  if (!user.wantExecute) {
    return { ...emptyExecution(), skippedReason: "execute_disabled" };
  }
  if (user.halted) {
    return { ...emptyExecution(), skippedReason: "operations_suspended" };
  }
  if (legs.length === 0) {
    return { ...emptyExecution(), skippedReason: "no_allocation" };
  }

  const info = getNetwork(opts.network);
  if (opts.sourceChainId === null || opts.sourceChainId !== info.chainId) {
    return {
      ...emptyExecution(),
      skippedReason: `chain_mismatch:markets=${opts.sourceChainId ?? "none"}:wallet=${info.chainId}`,
    };
  }

  const chain = info.chainId === 56 ? bsc : bscTestnet;
  const client = createPublicClient({ chain, transport: http(info.rpcUrl) });
  const wallet = getWallet();
  const steps: ExecutionStep[] = [];
  let broadcast = false;

  for (const leg of legs) {
    const underlying = asAddr(leg.underlying);
    const vToken = asAddr(leg.vToken);
    if (leg.protocol !== "venus" && leg.protocol !== "aave") {
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: vToken,
        amountUsd: 0,
        txHash: null,
        status: "skipped",
        detail: `protocol_execution_not_wired:${leg.protocol}`,
      });
      continue;
    }
    const spender = leg.protocol === "aave" ? asAddr(AAVE_BNB_POOL) : vToken;
    if (
      !PROTOCOL_ALLOWLIST.has(underlying.toLowerCase()) ||
      !PROTOCOL_ALLOWLIST.has(vToken.toLowerCase()) ||
      !PROTOCOL_ALLOWLIST.has(spender.toLowerCase())
    ) {
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: vToken,
        amountUsd: 0,
        txHash: null,
        status: "skipped",
        detail: "contract_not_whitelisted",
      });
      continue;
    }

    let decimals = 18;
    let balance = 0n;
    try {
      decimals = Number(
        await client.readContract({
          address: underlying,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      );
      balance = await client.readContract({
        address: underlying,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address],
      });
    } catch (error) {
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: vToken,
        amountUsd: 0,
        txHash: null,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const cappedUsd = Math.min(leg.amountUsd, user.maxAllocationUsd, MAX_EXECUTE_USD);
    const wanted = toRaw(cappedUsd.toFixed(2), decimals);
    const amount = wanted < balance ? wanted : balance;
    if (amount <= 0n) {
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: vToken,
        amountUsd: 0,
        txHash: null,
        status: "skipped",
        detail: "no_token_balance",
      });
      continue;
    }

    const amountUsd = Number(amount) / 10 ** decimals;
    try {
      const approve = await executeWhitelistedCall({
        network: opts.network,
        to: underlying,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
        allowlist: PROTOCOL_ALLOWLIST,
        description: `${leg.protocol} approve ${leg.asset}`,
      });
      steps.push({
        op: "approve",
        asset: leg.asset,
        token: underlying,
        amountUsd,
        txHash: approve.transactionHash,
        status: "sent",
        detail: "ok",
      });
      const deposit =
        leg.protocol === "aave"
          ? await executeWhitelistedCall({
              network: opts.network,
              to: spender,
              abi: AAVE_POOL_ABI,
              functionName: "supply",
              args: [underlying, amount, wallet.address, 0],
              allowlist: PROTOCOL_ALLOWLIST,
              description: `Aave supply ${leg.asset}`,
            })
          : await executeWhitelistedCall({
              network: opts.network,
              to: vToken,
              abi: VTOKEN_ABI,
              functionName: "mint",
              args: [amount],
              allowlist: PROTOCOL_ALLOWLIST,
              description: `Venus mint v${leg.asset}`,
            });
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: leg.protocol === "aave" ? spender : vToken,
        amountUsd,
        txHash: deposit.transactionHash,
        status: "sent",
        detail: "ok",
      });
      broadcast = true;
    } catch (error) {
      steps.push({
        op: "mint",
        asset: leg.asset,
        token: vToken,
        amountUsd,
        txHash: null,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const skippedAll = steps.every((s) => s.status !== "sent");
  return {
    attempted: true,
    broadcast,
    skippedReason: broadcast
      ? null
      : skippedAll
        ? (steps.find((s) => s.detail === "no_token_balance")
          ? "no_token_balance"
          : steps[0]?.detail ?? "execution_failed")
        : null,
    steps,
  };
}
