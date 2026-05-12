# Agent on-chain registration — runbook

> Plan E2 / Theme B. Two-tx flow that anchors an existing ArkAge agent on the canonical Arc Testnet contracts: ERC-8004 IdentityRegistry (mints the identity NFT) + ArkAge AgentRegistry (binds operator/policy on-chain).

## When to run this

For any agent you want to make **permissionlessly verifiable** without ArkAge's API in the loop. After running, anyone can query:

- `IdentityRegistry.ownerOf(chainAgentId)` → builder's Tier 1 wallet
- `AgentRegistry.agents(chainAgentId)` → `(operator, policyHash, perTxCap, evaluatorFeeMax, active)`

Existing agents continue to work fine without anchoring; this is opt-in.

## Prerequisites

- The agent already exists in ArkAge's Postgres (off-chain registration via `arkage:bootstrap_user` or `arkage:register_agent_wallet`).
- The builder's Tier 1 wallet has enough native USDC for gas on Arc Testnet — a fraction of a cent suffices for the two tx, but the wallet needs *some* balance. Faucet at `https://faucet.circle.com`.
- The Tier 1 private key is available to whoever runs the smoke (testnet only — production flow will use the dashboard passkey path described in Plan E2 Phase 3, not yet shipped).

## The flow

Two transactions, both signed by the builder's Tier 1 wallet:

| Step | Call | Why |
|---|---|---|
| 1 | `IdentityRegistry.register(metadataURI)` | Mints a fresh ERC-721 token to `msg.sender` (Tier 1). Token id is auto-assigned (sequential) and emitted in the `Transfer` event. |
| 2 | `AgentRegistry.registerAgent(tokenId, operator, policyHash, perTxCap, evaluatorFeeMax)` | Binds the freshly-minted token id to the agent's Tier 2 operator + on-chain policy commitment. Modifier `onlyIdentityOwner` enforces step 1 happened first. |

State machine on the Postgres side:

```
agent.chain_agent_id                = NULL                → Postgres-only
agent.chain_agent_id                = <token id>           → Tx 1 confirmed
agent.identity_register_tx_hash     = <tx 1 hash>
agent.chain_agent_id                = <token id>
agent.identity_register_tx_hash     = <tx 1 hash>
agent.agent_registry_tx_hash        = <tx 2 hash>          → Fully on-chain anchored
agent.on_chain_registered_at        = <timestamp>
```

The three MCP tools driving this:

- `arkage:register_agent_onchain` — encodes Tx 1 envelope. Refuses if already anchored.
- `arkage:complete_onchain_registration` — polls Tx 1 receipt, parses minted token id, writes it to the agent row, encodes Tx 2 envelope.
- `arkage:finalize_onchain_registration` — polls Tx 2 receipt, validates target contract, stamps `on_chain_registered_at`.

All three are idempotent — re-running picks up wherever the prior run left off. Builder ownership is enforced.

## Running the smoke

```bash
# Stage your Tier 1 private key (the key for your builder wallet) once.
# The script reads from an env var keyed on the lowercased address — never
# pass the key on the command line, never log it.
export ARKAGE_TIER1_KEY_0x172b7952b0f711b8b372410e81d51dcba7d4bb02=0xYOUR_KEY

npm run smoke:onchain-anchor -- 0x172B7952b0F711b8B372410E81d51Dcba7D4BB02 <agentDbId>

# When done, unset to keep it out of your environment.
unset ARKAGE_TIER1_KEY_0x172b7952b0f711b8b372410e81d51dcba7d4bb02
```

`<agentDbId>` is the Postgres `id` of the agent — not the chain id, not the synthetic `agent_id`. Find it in `arkage:get_my_agents` output or the console.

## What you'll see when it works (worked example, 2026-05-12)

```
Builder: 0x172b7952b0f711b8b372410e81d51dcba7d4bb02
Agent dbId: 16
Tier 1 derived address: 0x172B7952b0F711b8B372410E81d51Dcba7D4BB02

[1/3] Encoding Tx 1 (IdentityRegistry.register)...
      target: 0x8004A818BFB912233c491871b3d84c89A494BD9e
      calldata: 0xf2c298be000000000000000000000000...
      metadataURI: inline://arkage/agent/16

      Broadcasting Tx 1...
      Tx 1 hash: 0x88cb8c78f09be3247bbbeb0a1ea9a846e5bd222145ccc0ca3f6b72a1a32014c2
      https://testnet.arcscan.app/tx/0x88cb8c78...
      Waiting for Tx 1 receipt...

[2/3] Resolving minted token id + encoding Tx 2...
      Chain agent id: 5285
      target: 0x06f606686016E5D015A4f0236307524E86E013e4
      calldata: 0x6fe18911000000000000000000000000...
      Broadcasting Tx 2...
      Tx 2 hash: 0xfc21a262ed4eb73313ada4d578f5ea7733bfff45e1bce40ca9cff077697fe8bd
      Waiting for Tx 2 receipt...

[3/3] Finalizing on-chain anchoring...

Done. Agent 16 is on-chain anchored.
  - chain agent id: 5285
  - identity tx:    0x88cb8c78...
  - registry tx:    0xfc21a262...
```

After completion, the agent's public profile page (`/agents/<chainOrSyntheticId>`) shows a clickable **"On-chain #5285 ↗"** badge linking to the IdentityRegistry mint tx on Arcscan. Independent verification:

```bash
cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e \
  "ownerOf(uint256)(address)" 5285 \
  --rpc-url https://rpc.testnet.arc.network
# → 0x172B7952b0F711b8B372410E81d51Dcba7D4BB02 (the builder's Tier 1)

cast call $ARKAGE_AGENT_REGISTRY_ADDRESS \
  "agents(uint256)(address,bytes32,uint128,uint64,bool)" 5285 \
  --rpc-url https://rpc.testnet.arc.network
# → 0x86f97b...ee77, 0x7ac776...138fc, 10000000, 1000000, true
```

## Known issue + workaround — viem auto-gas evicted from Arc mempool

First smoke attempt on 2026-05-12: viem's default `sendTransaction` produced a tx hash that was never mined and never appeared in `eth_getTransactionByHash` — the chain dropped it from the mempool silently. Arc's sub-second block cadence appears to evict marginally-priced txs aggressively.

The script's `broadcastWithBuffer` helper fixes this by fetching `eth_gasPrice` and setting explicit EIP-1559 params at **150% of the chain price**. Fees are still trivial in USDC terms (sub-cent), and validators include immediately. If a tx still gets dropped, bump the multiplier (currently `150n / 100n` in `scripts/smoke-onchain-anchor.ts`).

## Idempotency cookbook

- **Re-running after a clean success**: prints "Already on-chain anchored at chain id X. Nothing to do." Exits 0.
- **Re-running after Tx 1 landed but Tx 2 was never broadcast** (DB has `chain_agent_id` but not `agent_registry_tx_hash`): re-fetches the Tx 2 envelope, signs and broadcasts Tx 2 only.
- **Re-running after Tx 1 was broadcast but never landed** (DB still has `chain_agent_id IS NULL`): broadcasts a fresh Tx 1. The previous (dropped) tx hash is harmless.

## Not yet covered

- **Dashboard mint flow** (Plan E2 Phase 3) — UI button that walks builders through both txs without needing the smoke script. Deferred; track in Plan E2 doc.
- **IPFS / Vercel Blob metadata** — current `metadataURI` is `inline://arkage/agent/<dbId>` for testnet. Mainnet flows should use real IPFS pinning; Theme F captures the migration.
- **Reputation registry initialization** — Plan E originally called for seeding a zero-feedback entry per agent. Walked back: reputation accumulates organically via the existing `ReputationHook` as jobs settle. Nothing to do at registration time.

## Related files

- Plan: `docs/superpowers/plans/2026-05-12-plan-e2-onchain-erc-8004-registration.md`
- Smoke script: `scripts/smoke-onchain-anchor.ts`
- MCP tools: `src/mcp/tools/identity/{register,complete,finalize}-*-onchain-registration.ts`
- Encoders + log parsing: `src/lib/erc-8004.ts`
- ABIs: `src/lib/abis/erc-8004.ts`
- Foundry interface: `contracts/src/interfaces/IIdentityRegistry.sol`
