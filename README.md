# yieldmanager

BNB Chain seller agent that produces a **risk-engine-validated yield allocation** for USDC and USDT. Buyers pay **$0.10** (ERC-8183 / X402). The model explains the report; it never signs. Deposit transactions are prepared as **unsigned calldata** for the client’s own wallet (MetaMask).

Built at **BNB Builder Sessions Paris** (10 November 2026) with [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio) (`bag`).

## Features

- Profiles: `low` · `moderate` · `high`
- Venues: Venus, Aave V3, Lista, Kinza, PancakeSwap stables (BSC)
- Optional wallet input: reads on-chain USDC/USDT (BSC mainnet) and sizes the plan to actual balances
- Deterministic Risk Engine (caps, liquidity, allowlisted contracts)
- LLM (Pieverse) calls `analyze_yield` then writes a short French/English brief; on 429 the engine report is returned without the model
- Local desk UI with a **Sign all in MetaMask** flow (approve → supply, one confirmation per tx)

## Architecture

```
Client  →  Agent (Pieverse)  →  analyze_yield tool
                                      ↓
                               Risk Engine (no LLM)
                                      ↓
                         Report + unsigned calldata
                                      ↓
                         Client signs in MetaMask
```

Signing for ERC-8183 quotes/submits lives in `app/agent/src/signing.ts` (fixed code, not a tool). Yield deposits are **never** signed by the Studio keystore when a client address is present.

## Limits

| Item | Behavior |
| --- | --- |
| Agent custody | The Studio wallet is a **testnet seller**. It does not hold or spend the client’s stables. |
| Chain split | Studio trial targets **BSC testnet**. Venus/Aave USDC–USDT markets used here are **mainnet**. Agent-wallet mint is refused (`chain_mismatch`). |
| MetaMask | Client wallet, **BSC mainnet**, one popup per transaction. |
| Lista / Kinza / Pancake | Included in the allocation; **no** calldata (UI links only). Venus and Aave only for MetaMask. |
| Pieverse `auto/free` | Rate limits (HTTP 429) are common; UI falls back to the engine JSON. |
| Yield | Spot APYs, not guaranteed. No leverage, no auto-rebalance. |

Do not commit `.studio/` (encrypted keystore and `.env.local`).

## Quick start

Requires **Node.js 22+** and pnpm (`corepack enable`).

```bash
git clone https://github.com/lattewei/bnb-workshop.git
cd bnb-workshop
pnpm install
cd app/agent && pnpm ui
```

Open [http://127.0.0.1:3333](http://127.0.0.1:3333). Optional test address (large BSC USDT): `0x8894E0a0c962CB723c1976a4421c95949bE2D4E3`.

### Studio seller (quote, pay, deploy)

```bash
npm install -g @bnbagent/studio-cli@latest
cd bnb-workshop/app/agent
bag wallet new --generate-password    # throwaway testnet wallet
bag llm activate                      # Pieverse, zero deposit
cd ../..
bag doctor
bag dev                               # A2A + X402 on :9000
```

48h BNB trial:

```bash
bag platform login
bag deploy --provider bnb
bag deploy verify --provider bnb
```

If `bsc-testnet-rpc.publicnode.com` fails DNS:

```bash
set STUDIO_BSC_TESTNET_RPC=https://bsc-testnet.bnbchain.org
```

## Layout

| Path | Role |
| --- | --- |
| `app/agent/src/yield/` | Risk engine, market fetchers, unsigned actions |
| `app/agent/src/yield/agent.ts` | LLM + `analyze_yield` tool |
| `app/agent/src/signing.ts` | ERC-8183 / allowlisted writes |
| `app/agent/public/yield.html` | Local desk |
| `app/agent/studio.toml` | Network, LLM, `$0.10` seller price |
| `.studio/` | Keystore + env (**gitignored**) |

## Stack

`@bnbagent/studio-cli` 0.0.16 · AgentCore · A2A + X402 · TypeScript · Pieverse `auto/free` · viem

## Disclaimer

Not financial advice. Workshop code. Use only funds you can afford to lose. Testnet keys must never be reused on mainnet.
