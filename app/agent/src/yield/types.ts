export const ALLOWED_ASSETS = ["USDC", "USDT"] as const;
export type AllowedAsset = (typeof ALLOWED_ASSETS)[number];

export const RISK_PROFILES = ["low", "moderate", "high"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const APPROVED_PROTOCOLS = ["venus", "aave", "lista", "kinza", "pancake"] as const;
export type ApprovedProtocol = (typeof APPROVED_PROTOCOLS)[number];

export type ProfileRules = {
  maxSingleWeightPercent: number;
  maxUtilization: number;
  maxStableApyPercent: number;
  minApyPercent: number;
  cashBufferPercent: number;
  preferApy: boolean;
  maxProtocolWeightPercent: number;
  minLiquidityUsd: number;
};

export type UserConfig = {
  amountUsd: number;
  assets: AllowedAsset[];
  riskProfile: RiskProfile;
  requestedProfile: RiskProfile;
  profileForced: boolean;
  maxAllocationUsd: number;
  minLiquidityUsd: number;
  wantExecute: boolean;
  halted: boolean;
  clientAddress: `0x${string}` | null;
};

export type Holdings = {
  chainId: number;
  address: `0x${string}`;
  usdc: number;
  usdt: number;
  totalUsd: number;
};

export type ClientAction = {
  title: string;
  protocol: ApprovedProtocol;
  asset: AllowedAsset;
  to: string | null;
  data: `0x${string}` | null;
  amountUsd: number;
  signed: false;
  url: string;
};

export type MarketSnapshot = {
  protocol: ApprovedProtocol;
  chainId: number;
  asset: AllowedAsset;
  symbol: string;
  vToken: string;
  underlying: string;
  comptroller: string;
  supplyApyPercent: number;
  rewardApyPercent: number;
  liquidityUsd: number;
  utilization: number;
  listed: boolean;
  paused: boolean;
  priceInvalid: boolean;
  withdrawal: string;
  pairAssets?: AllowedAsset[];
};

export type RejectedMarket = {
  market: MarketSnapshot | { asset?: string; protocol?: string; vToken?: string };
  reasons: string[];
};

export type AllocationLeg = {
  asset: AllowedAsset;
  protocol: ApprovedProtocol;
  vToken: string;
  underlying: string;
  weightPercent: number;
  amountUsd: number;
  advertisedApyPercent: number;
  netApyPercent: number;
  liquidityUsd: number;
  utilization: number;
};

export type SimulatedStep = {
  op: "approve" | "mint" | "redeem";
  protocol: ApprovedProtocol;
  token: string;
  spender?: string;
  amountUsd: number;
  signed: false;
};

export type ExecutionStep = {
  op: "approve" | "mint";
  asset: AllowedAsset;
  token: string;
  amountUsd: number;
  txHash: string | null;
  status: "sent" | "skipped" | "failed";
  detail: string;
};

export type ExecutionResult = {
  attempted: boolean;
  broadcast: boolean;
  skippedReason: string | null;
  steps: ExecutionStep[];
};

export type YieldReport = {
  ok: boolean;
  generatedAt: string;
  network: string;
  marketSource: string;
  sourceChainId: number | null;
  user: UserConfig;
  opportunities: MarketSnapshot[];
  rejected: RejectedMarket[];
  allocation: AllocationLeg[];
  cashUsd: number;
  portfolioNetApyPercent: number | null;
  simulation: {
    mode: "plan";
    steps: SimulatedStep[];
    notes: string[];
  };
  execution: ExecutionResult;
  holdings: Holdings | null;
  actions: ClientAction[];
  risk: {
    blocked: boolean;
    reasons: string[];
  };
  disclaimers: string[];
  log: string[];
};
