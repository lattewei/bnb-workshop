# yieldmanager

Agent vendeur BNB Chain : tu paies **0,10 $**, il lit tes USDC/USDT, propose une allocation yield (Venus, Aave, Lista, Kinza, PancakeSwap) selon le risque, et te prépare les txs **à signer toi-même dans MetaMask**.

L’IA explique. Le **Risk Engine** calcule. L’IA **ne signe pas**.

## Contexte

Fait pendant **BNB Builder Sessions Paris** (10 novembre 2026, IIM Nanterre) — workshop [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio) (`bag`), une soirée pour sortir un agent on-chain en quelques heures.

Cahier des charges : *Autonomous Yield Manager* — conseiller DeFi conservateur sur BSC, stables only, l’utilisateur garde le contrôle des fonds.

Repo : https://github.com/lattewei/bnb-workshop

## Ce que ça vend

1. Tu donnes un montant **ou** une adresse BSC.
2. L’agent appelle `analyze_yield` (données Venus + DefiLlama).
3. Le Risk Engine alloue (profils `low` / `moderate` / `high`).
4. Livrable : texte FR + JSON + checklist (liens + calldata).
5. Bouton **Tout signer dans MetaMask** : une popup par tx (`approve` puis `supply`), **ton** wallet, BSC **mainnet**.

Rail commerce Studio : A2A + X402, prix **0,10 USD** (ERC-8183). En local, `pnpm ui` donne le même livrable **sans payer**.

## Limites (important)

| Limite | Réalité |
| --- | --- |
| Placement auto par l’agent | **Non.** Le wallet Studio est un vendeur testnet. Tes USDC ne sont pas dessus. |
| Trial BNB | Agent sur **BSC testnet**. Les marchés Venus/Aave stables sont **mainnet**. Dépôt depuis le wallet agent → `chain_mismatch`. |
| MetaMask | Signe **ton** wallet mainnet, pas celui de l’agent. Une confirmation par tx. |
| Lista / Kinza / Pancake | Dans l’allocation, **pas** de calldata (lien UI seulement). Venus + Aave seulement pour MetaMask. |
| LLM Pieverse `auto/free` | Rate-limit fréquent (429). Fallback : rapport Risk Engine sans prose IA. |
| RPC testnet publicnode | DNS parfois down. Override : `STUDIO_BSC_TESTNET_RPC`. |
| Pas une promesse de yield | APY instantanés, variables. Pas de levier, pas de rééquilibrage auto. |
| Secrets | Ne jamais committer `.studio/` (keystore + `.env.local`). |

## Setup rapide

Prérequis : **Node 22+**, pnpm (`corepack enable`).

```bash
git clone https://github.com/lattewei/bnb-workshop.git
cd bnb-workshop
pnpm install
cd app/agent
pnpm ui
```

Ouvre http://127.0.0.1:3333 — montant, profil, optionnellement un `0x…` BSC mainnet.

Wallet de démo (gros USDT) : `0x8894E0a0c962CB723c1976a4421c95949bE2D4E3`

### Agent Studio (payer / déployer)

```bash
npm install -g @bnbagent/studio-cli@latest
cd bnb-workshop
bag wallet new --generate-password   # depuis app/agent, throwaway testnet
bag llm activate                     # Pieverse, 0 $
bag doctor
bag dev                              # A2A :9000
```

Trial 48h :

```bash
bag platform login
bag deploy --provider bnb
bag deploy verify --provider bnb
```

## Stack

- `@bnbagent/studio-cli` 0.0.16 · runtime AgentCore · faces A2A + X402
- TypeScript, Pieverse `auto/free`
- Risk Engine déterministe : `app/agent/src/yield/`
- UI locale : `app/agent/public/yield.html` · `pnpm ui`

## Licence

Code du workshop, tel quel. Pas un produit financier. Testnet / fonds que tu peux perdre.