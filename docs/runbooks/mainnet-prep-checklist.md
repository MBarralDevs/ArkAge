# Mainnet readiness checklist

> Plan F deliverable. ArkAge is testnet-only today. This runbook captures everything that needs to be re-verified, parameterized, deployed, or rotated **before** flipping to mainnet. Nothing here is executed yet — this is the punch list for when Arc opens mainnet and we (or someone else) decides to migrate.

## State after Plan F (2026-05-14)

Chain identity is now centralized in [`src/lib/chain.ts`](../../src/lib/chain.ts). One `activeChain` export drives:
- `CHAIN_ID` (decimal) — used by webhook handlers, wallet-router error messages, footer display
- `CHAIN_ID_HEX` — used by `wallet_switchEthereumChain` in the mint-flow UI
- `CAIP2` — used by x402-batching's `createGatewayMiddleware`
- `EXPLORER_BASE` + `txLink()` + `addressLink()` — used by every Arcscan deep link in the UI

Switching the active chain to mainnet is a **one-file edit** in `chain.ts` (define `arcMainnet`, change `activeChain`). No grep-and-replace required.

Other parameterized surfaces:
- `env.ARC_TESTNET_RPC_HTTP` / `ARC_TESTNET_RPC_WS` — already env-staged
- `env.ARKAGE_X402_FACILITATOR_URL` — already env-staged, defaults to Circle testnet facilitator if unset
- `env.ARKAGE_*_ADDRESS` (5 ArkAge contracts + validator) — already env-staged
- `env.ARC_TESTNET_RPC_HTTP` is named for testnet today; rename to `ARC_RPC_HTTP` at mainnet flip

## Pre-flight verification (do before mainnet deploy)

- [ ] Verify Arc mainnet chain id and confirm finality model still matches Arc Testnet (sub-second deterministic — if not, x402 facilitator gas-buffer logic in `scripts/smoke-onchain-anchor.ts` may need tuning)
- [ ] Run `cast code <address> --rpc-url $ARC_MAINNET_RPC_HTTP` against every canonical address (ERC-8183 AgenticCommerce, ERC-8004 IdentityRegistry / ReputationRegistry / ValidationRegistry, Circle GatewayWallet, GatewayMinter, USDC). **Do not assume testnet addresses carry over.**
- [ ] Verify Circle's mainnet facilitator URL via the latest `@circle-fin/x402-batching` SDK release notes. Set `ARKAGE_X402_FACILITATOR_URL` accordingly.
- [ ] Confirm Circle Agent Wallets mainnet status. Per `reference_circle_agent_wallets_facts.md`, Arc Mainnet was NOT in Circle's supported-chains list as of 2026-05-12. Re-check; this gates Plan E1's whole onramp on mainnet.
- [ ] Confirm Circle CLI deposit bug (Plan E1 Task 12 blocker) is patched on mainnet. The 2026-05-12 bug only manifested on Arc Testnet; mainnet may or may not be affected.

## ArkAge contract deploy (5 + 2 = 7 contracts)

- [ ] Compute deterministic CREATE2 addresses using the same salt as testnet (or rotate — your call). Save addresses to `contracts/deployments/arc-mainnet.json`.
- [ ] Run `forge script script/Deploy.s.sol --rpc-url arc_mainnet --private-key "$PRIVATE_KEY" --broadcast --verify --verifier blockscout --verifier-url <mainnet-arcscan-api>` once the `arc_mainnet` foundry profile is added.
- [ ] Decide whether to deploy E.3 reference hooks (RateLimitHook + RoyaltyHook). They're optional — `script/Deploy.s.sol` does NOT include them today. Add manually if shipping.
- [ ] Verify all deployed contracts on Arcscan (mainnet equivalent).
- [ ] Run Foundry invariant tests against a forked mainnet snapshot (`forge test --fork-url $ARC_MAINNET_RPC_HTTP`) — confirm Risk #1 (no NFT-touching paths) still holds under mainnet conditions.

## Env var migration

Vars that need fresh mainnet values:

| Var | Today | Mainnet action |
|---|---|---|
| `ARC_TESTNET_RPC_HTTP` / `_WS` | Testnet RPC | Rename to `ARC_RPC_HTTP` / `_WS`; point at mainnet RPC |
| `ARKAGE_X402_FACILITATOR_URL` | Circle testnet facilitator | Point at Circle mainnet facilitator |
| `ARKAGE_HOOK_COMPOSER_ADDRESS` | Testnet contract | New mainnet address |
| `ARKAGE_REPUTATION_HOOK_ADDRESS` | Testnet contract | New mainnet address |
| `ARKAGE_POLICY_HOOK_ADDRESS` | Testnet contract | New mainnet address |
| `ARKAGE_EVALUATOR_FEE_HOOK_ADDRESS` | Testnet contract | New mainnet address |
| `ARKAGE_AGENT_REGISTRY_ADDRESS` | Testnet contract | New mainnet address |
| `ARKAGE_VALIDATOR_WALLET_ADDRESS` | Testnet validator EOA | Fresh mainnet validator EOA + adequate USDC funding |
| `ARKAGE_TIER1_KEY_*` / `ARKAGE_TIER2_KEY_*` | Local-only env-staged keys | DO NOT migrate. Mainnet must use Circle Agent Wallets exclusively (Plan E1 design). The env-staged-key path is testnet-only. |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Neon testnet branch | New Neon production branch. Run `prisma migrate deploy` against it. |
| `ARKAGE_RP_ID` / `ARKAGE_RP_ORIGIN` | Auto-resolves from `VERCEL_PROJECT_PRODUCTION_URL` | Will auto-update when production URL changes; explicit overrides only if custom domain (`arkage.network`). |
| `CRON_SECRET` | Testnet value | Rotate. |
| `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` | Testnet sandbox keys | New production keys from Circle Console. |

Total env vars to rotate / regenerate: ~14 + per-builder TIER2 keys (which mainnet abandons entirely).

## Cost model (Plan E2 + smoke)

Testnet gas is sub-cent USDC. On mainnet:
- `IdentityRegistry.register(string)` — single ERC-721 mint, ~150k gas. At mainnet gas prices (whatever Arc settles on), expect a few cents per agent registration.
- `AgentRegistry.registerAgent(...)` — state write + 1 storage map insert + 1 event, ~100k gas. Similar cost.
- **Per-agent on-chain anchoring: estimate $0.10–$0.50** depending on Arc mainnet gas. If higher than expected, add a Multicall3 batched path before public launch.

## Data model

- [ ] All Postgres migrations apply cleanly on a fresh database: `prisma migrate deploy`. Confirmed locally; re-confirm on the prod Neon branch.
- [ ] Plan E1 wallets table extension (custody / circle_agent_wallet_email / circle_backing_eoa) and Plan E2 agent table extension (chain_agent_id / identity_register_tx_hash / agent_registry_tx_hash / on_chain_registered_at) plus Plan E1-disputes phase 2.2 (counterparty_response_jsonb / counterparty_responded_at): all already in `prisma/migrations/`.

## Indexer

- Goldsky Mirror is currently testnet. Add a parallel mainnet pipeline once contracts deploy. Circle Contract Platform webhooks (for our 7 contracts) also need new subscriptions pointing at mainnet contract addresses.

## Things explicitly out of scope for F

- Actually deploying to mainnet (waits for Arc mainnet GA + ArkAge legal review)
- Cross-chain (Base, Optimism). Single-chain on mainnet; multi-chain is v2.
- Formal contract verification (Certora / Halmos). Pre-significant-TVL nice-to-have, not a v1.5 blocker.

## Quick sanity check before flipping

After completing every checkbox above:

```bash
# 1. confirm chain.ts points at the mainnet definition
grep -A2 "export const activeChain" src/lib/chain.ts

# 2. confirm no stale testnet refs in src/
grep -rn "testnet.arcscan.app\|gateway-api-testnet" src/
# expected: zero hits

# 3. confirm contract addresses resolve
grep -rn "5042002\|0x4cef52" src/ | grep -v "src/lib/chain.ts"
# expected: zero hits (chain.ts is the only place chain id appears)
```

If any of those greps return hits outside `src/lib/chain.ts`, halt the migration and fix.
