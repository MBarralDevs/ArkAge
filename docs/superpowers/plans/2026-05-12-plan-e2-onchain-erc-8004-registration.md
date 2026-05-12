# Plan E2 — On-chain ERC-8004 + AgentRegistry registration (Theme B execution)

> Execute task-by-task with `superpowers:executing-plans`. Each task ~5-15 min, commit per task or per phase.

**Parent:** Plan E (`2026-05-11-plan-e-v1.5-circle-agent-stack-integration.md`), Theme B.

**Goal:** Move ArkAge agents from "Postgres-only" to "on-chain anchored." Each registered agent gets a real ERC-8004 IdentityRegistry NFT (owned by Tier 1) plus a binding entry in our `AgentRegistry` contract. Today's "synthetic" agent ids (`999070`, `998071`) stay as local handles; a new `chain_agent_id` column carries the on-chain token id once minted. Existing agents keep working untouched — on-chain promotion is opt-in.

**Why now:** the v1.5 strategic story (Plan E) leans on "permissionless registry" positioning. Today we don't earn that — anyone can read our DB but not query us from-chain. Earning it unblocks Theme D (`agents.circle.com` marketplace listings, which almost certainly want the on-chain anchor for the reputation badge), strengthens the "reason field threading" claim (off-chain evidence → on-chain settlement → on-chain reputation), and lays the groundwork for cross-system interop where ArkAge isn't in the loop.

---

## Reality-check from pre-flight (2026-05-12)

Verified on Arc Testnet:

- **IdentityRegistry `0x8004A818...4BD9e`** — live. UUPS proxy. `ownerOf(0)` returns `0xb7ACAC...41553` (some external agent already minted). Standard OZ ERC-721 errors (`ERC721NonexistentToken(uint256)` selector `0x7e273289`).
- **ReputationRegistry `0x8004B663...B7388713`** — live. UUPS proxy.
- **ValidationRegistry `0x8004Cb1B...EB4272`** — live. UUPS proxy.
- **ERC-8183 AgenticCommerce `0x0747EEf...4583`** — live. Minimal-proxy (EIP-1167) pattern.
- **Our AgentRegistry** at `ARKAGE_AGENT_REGISTRY_ADDRESS` — live. `agents(0)` returns empty struct. `registerAgent` enforces `onlyIdentityOwner(agentId)`.

**Canonical write ABI for ERC-8004 IdentityRegistry on Arc:**

```solidity
function register(string metadataURI) external;
// Emits: event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
// Returns: nothing — read tokenId from the Transfer event log.
```

Token ids are auto-assigned sequential; the caller cannot pick one. The agent identity NFT is minted to `msg.sender`.

**Existing scaffolding to leverage:**

- `contracts/src/interfaces/IIdentityRegistry.sol` — read-only (`ownerOf`, `isApprovedForAll`, `getApproved`). Extend with `register`.
- `contracts/src/interfaces/IReputationRegistry.sol` — already has `giveFeedback`.
- `contracts/src/interfaces/IAgentRegistry.sol` — already has `registerAgent`.
- `src/lib/tier1-modular.ts` exposes `PendingTier1Signature` for the dashboard signing flow.
- `src/mcp/tools/identity/bootstrap-user.ts` already returns a placeholder `pendingActions[0]` with `data: "0x"` for the ERC-8004 register call — to be replaced with real calldata.
- `src/components/console/pending-actions-panel.tsx` exists for surfacing pending Tier 1 signatures.
- ReputationHook already writes feedback for settled jobs; no need to "initialize" reputation at registration time (revised from Plan E theme B's initial sketch).

---

## Strategic refinement (vs Plan E's original Theme B sketch)

Plan E said "every registered agent gets a ReputationRegistry initial-feedback entry." Walking it back: that entry would need a non-owner submitter (per ERC-8004 Risk #1) and a real feedback payload — neither is meaningful at registration time. Skip that step. Reputation accumulates organically via `ReputationHook` as jobs settle.

So the on-chain anchoring is **two transactions per agent**:

1. **Tx 1** — `IdentityRegistry.register(metadataURI)` from Tier 1 → emits `Transfer(0x0, tier1, tokenId)` → ArkAge reads tokenId.
2. **Tx 2** — `AgentRegistry.registerAgent(tokenId, operator, policyHash, perTxCap, evaluatorFeeMax)` from the same Tier 1 → binds.

Both signed via passkey. Tx 2 cannot be prepared until Tx 1 lands and emits the Transfer event.

---

## File structure produced

```
ArkAge/
├── prisma/migrations/2026XXXXXXXXXX_agent_chain_anchor/migration.sql
├── contracts/src/interfaces/IIdentityRegistry.sol         # MODIFIED: add register
├── src/lib/
│   ├── abis/erc-8004.ts                                   # NEW: minimal viem-style ABIs
│   ├── erc-8004.ts                                        # NEW: encode helpers + Transfer log parsing
│   └── addresses.ts                                       # already has the 4 addresses
├── src/mcp/tools/identity/
│   ├── register-agent-onchain.ts                          # NEW: returns Tx 1 envelope
│   ├── complete-onchain-registration.ts                   # NEW: takes the Tx 1 hash, returns Tx 2 envelope
│   └── bootstrap-user.ts                                  # MODIFIED: real calldata + chain anchor flow
├── src/app/api/actions/
│   └── confirm-onchain-mint/route.ts                      # NEW: dashboard callback after Tx 1 lands
├── src/app/console/agents/[id]/page.tsx                   # MODIFIED: show "Mint on-chain" CTA or chain id
├── src/app/(public)/agents/[id]/page.tsx                  # MODIFIED: show on-chain anchor
├── src/components/console/mint-onchain-identity-button.tsx # NEW
├── src/components/agents/onchain-anchor-badge.tsx         # NEW
└── tests/
    ├── unit/erc-8004.test.ts                              # NEW: ABI encode/decode
    ├── integration/register-agent-onchain.test.ts         # NEW
    └── integration/complete-onchain-registration.test.ts  # NEW
```

---

## Phase 1 — Foundations (data, ABIs, encoders)

### Task 1: Migration — add chain anchor columns to `agents`

- [ ] Add nullable columns:
    - `chain_agent_id BIGINT NULL` — the ERC-8004 IdentityRegistry token id once minted
    - `identity_register_tx_hash BYTEA NULL` — tx hash of the register call
    - `agent_registry_tx_hash BYTEA NULL` — tx hash of the AgentRegistry binding
    - `on_chain_registered_at TIMESTAMPTZ NULL` — set after Tx 2 lands
- [ ] Index: `CREATE UNIQUE INDEX agents_chain_agent_id_unique ON agents(chain_agent_id) WHERE chain_agent_id IS NOT NULL` (partial unique, NULLs allowed many)
- [ ] Apply via `npm run db:migrate -- --name agent_chain_anchor`
- [ ] Update `prisma/schema.prisma` to match

### Task 2: Extend `IIdentityRegistry.sol` Foundry interface

- [ ] Add `function register(string calldata metadataURI) external;`
- [ ] Add `event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);`
- [ ] No new compilation; Foundry tests should stay green (we add functions, don't change existing ones)

### Task 3: `src/lib/abis/erc-8004.ts` — runtime ABIs

- [ ] Export a minimal viem-style ABI for IdentityRegistry covering: `register(string)`, the `Transfer` event, and the read functions already used (`ownerOf`, `isApprovedForAll`)
- [ ] Export AgentRegistry ABI covering: `registerAgent`, `agents`, `agentByOperator`
- [ ] No runtime code, just const-asserted ABI objects so viem's type inference works

### Task 4: `src/lib/erc-8004.ts` — encode + log-parse helpers

- [ ] `encodeIdentityRegister(metadataURI: string): \`0x${string}\`` — viem `encodeFunctionData`
- [ ] `encodeAgentRegistryRegister({chainAgentId, operator, policyHash, perTxCap, evaluatorFeeMax}): \`0x${string}\``
- [ ] `parseTokenIdFromTransferLogs(logs: TxLog[]): bigint | null` — finds the Transfer with `from == 0x0` and returns `tokenId`
- [ ] Unit tests covering: encode round-trips, Transfer parsing happy path, Transfer parsing when log not present (returns null), Transfer parsing when caller is different recipient
- [ ] Run `npx vitest run tests/unit/erc-8004.test.ts` — expect green

---

## Phase 2 — MCP tools + workflow orchestration

### Task 5: `arkage:register_agent_onchain` MCP tool

- [ ] Input: `agentDbId: string`, `metadataURI: string` (optional — default constructs an `inline://agent/<dbId>` URI for testnet smoke), `idempotencyKey: string`
- [ ] Auth: ctx.builderId must own the agent
- [ ] Validate: agent.chain_agent_id IS NULL (refuse if already on-chain)
- [ ] Returns:
    - `pendingActions: PendingTier1Signature[]` — exactly one entry, `unsignedTx = { to: IdentityRegistry, data: encodeIdentityRegister(metadataURI), value: "0" }`
    - `state: "awaiting_tx1"`
    - `metadataURI` (echoed back so the dashboard can store/cache it)
- [ ] Audit-log the request
- [ ] Integration test with mocked db + fixed metadataURI

### Task 6: `arkage:complete_onchain_registration` MCP tool

- [ ] Input: `agentDbId`, `identityRegisterTxHash: 0x${string}`, `idempotencyKey`
- [ ] Auth: same builder must own the agent
- [ ] Validate: agent.chain_agent_id IS NULL (refuse if Tx 2 already done)
- [ ] Fetch the tx receipt via viem against Arc Testnet RPC (use existing `src/lib/chain.ts` viem client if present, else add)
- [ ] Parse tokenId from Transfer logs via `parseTokenIdFromTransferLogs`
- [ ] If tokenId null → return `state: "tx1_pending"` (tx not yet mined or no Transfer event found) so the dashboard polls again
- [ ] If tokenId resolved → write `chain_agent_id = tokenId`, `identity_register_tx_hash = txHash` to the agents row
- [ ] Build Tx 2 envelope: `encodeAgentRegistryRegister({chainAgentId: tokenId, operator: agent.currentOperatorWallet.address, policyHash, perTxCap, evaluatorFeeMax})`
- [ ] Returns:
    - `pendingActions[0].unsignedTx = { to: AgentRegistry, data: <encoded>, value: "0" }`
    - `state: "awaiting_tx2"`
    - `chainAgentId: tokenId.toString()`
- [ ] Integration test with mocked viem + db

### Task 7: `arkage:finalize_onchain_registration` MCP tool

- [ ] Input: `agentDbId`, `agentRegistryTxHash: 0x${string}`, `idempotencyKey`
- [ ] Auth: same builder
- [ ] Validate: agent.chain_agent_id IS NOT NULL && agent_registry_tx_hash IS NULL
- [ ] Fetch receipt, confirm tx status is success (status === 1) and `to` matches AgentRegistry
- [ ] Optional: verify the deployed AgentRegistry now has an entry for `chain_agent_id` via a `cast call` — extra paranoid check, fail soft if RPC unreachable
- [ ] Write `agent_registry_tx_hash` + `on_chain_registered_at = NOW()`
- [ ] Return `state: "complete", chainAgentId`
- [ ] Integration test

### Task 8: Update `bootstrap_user` to thread through chain anchoring (optional path)

- [ ] Add input `enqueueChainAnchoring?: boolean` (default false)
- [ ] When true and mode produces a Tier 2 wallet, also enqueue the Tx 1 envelope in pendingActions (same as register_agent_onchain would)
- [ ] Replace the existing placeholder pendingAction (empty calldata) with real calldata
- [ ] Add an instructions[] entry pointing the builder at the dashboard
- [ ] Unit/integration test for the new flag

### Task 9: Register the 3 new tools in `register-all-tools.ts`

- [ ] Add side-effect imports
- [ ] Sanity: total tool count moves from 29 → 32

---

## Phase 3 — Dashboard surface

### Task 10: `MintOnchainIdentityButton` client component

- [ ] On the agent profile, when `chain_agent_id IS NULL` show a button "Mint on-chain identity"
- [ ] Clicking it calls `/api/actions/register-agent-onchain` (server-action route to be added) which wraps the MCP tool call + returns the first envelope
- [ ] Dashboard uses the passkey to sign the unsigned tx and broadcasts via viem
- [ ] After broadcast it POSTs to `/api/actions/confirm-onchain-mint` with the tx hash; that route polls until tokenId resolves (or returns "still pending — retry in N seconds")
- [ ] On tokenId resolved, dashboard prompts user to sign Tx 2 with the same UX
- [ ] Final state: a green check + "on-chain anchored as agent #<tokenId>"

### Task 11: Server-action route `/api/actions/register-agent-onchain`

- [ ] Auth gate on `currentBuilder()`
- [ ] Calls into the MCP handler `handleRegisterAgentOnchain` directly (skip HTTP MCP roundtrip)
- [ ] Returns the same envelope to the client

### Task 12: Server-action route `/api/actions/confirm-onchain-mint`

- [ ] Takes `{ agentDbId, identityRegisterTxHash }` from the client after broadcast
- [ ] Calls `handleCompleteOnchainRegistration`
- [ ] If state is `tx1_pending`, response includes `retryAfter: 5` so the client schedules a retry
- [ ] If state is `awaiting_tx2`, response includes the Tx 2 envelope ready to sign

### Task 13: Server-action route `/api/actions/finalize-onchain-mint`

- [ ] Takes `{ agentDbId, agentRegistryTxHash }`
- [ ] Calls `handleFinalizeOnchainRegistration`
- [ ] Triggers `router.refresh()` on the dashboard

### Task 14: `OnchainAnchorBadge` for both console + public agent profiles

- [ ] If `chain_agent_id != null`: green badge "On-chain #<id>" linking to Arcscan
- [ ] If null: outline badge "Draft (off-chain only)"
- [ ] Tooltip explains: "ERC-8004 IdentityRegistry token id. Anyone can query the agent without going through ArkAge's API."

### Task 15: Wire into existing agent profile pages

- [ ] `/console/agents/[id]` shows the badge and the mint button (when applicable)
- [ ] `/(public)/agents/[id]` shows the badge only

---

## Phase 4 — Smoke + cleanup

### Task 16: End-to-end testnet smoke (`scripts/smoke-onchain-register.ts`)

- [ ] Reads a builder + agent dbId from CLI args
- [ ] Calls the MCP register_agent_onchain handler to get the Tx 1 envelope
- [ ] Uses an env-staged private key (Tier 1 passkey not scriptable; fall back to a hardcoded testnet Tier 1 EOA for the smoke)
- [ ] Broadcasts Tx 1 via viem, waits for receipt
- [ ] Calls complete_onchain_registration, reads tokenId
- [ ] Broadcasts Tx 2
- [ ] Calls finalize_onchain_registration
- [ ] Prints: chainAgentId, both tx hashes, Arcscan links
- [ ] Note: this smoke is a developer aid; real users use the dashboard passkey flow

### Task 17: Documentation + memory updates

- [ ] Update `docs/runbooks/` with a new file `agent-onchain-registration.md` walking through the dashboard flow
- [ ] Update `CLAUDE.md`: Theme B status from "promised" to "shipped", mark Plan E1/E2 progress in v1.5 backlog block
- [ ] Update memory: `project_arkage_design.md` reflects on-chain anchoring milestone
- [ ] If smoke succeeds, tag `git tag plan-e2-complete`

---

## Out of scope (explicit)

- **Migrating existing v1 agents to on-chain.** One-time batch op; runbook only, not in Plan E2 protocol code.
- **Mainnet** — Arc has no mainnet; defer with Theme F.
- **ReputationRegistry initial seeding** — skipped per the strategic refinement above.
- **Cross-chain anchoring** — v2.
- **Pre-register before bootstrap_user** — bootstrap_user still creates the off-chain agent first; chain anchoring is opt-in.

---

## Risks + watchpoints

- **Gas on Arc Testnet is negligible**, but the deploy script comments assume USDC-as-gas semantics. Confirm gas estimation works through viem's default flow before scripting the smoke.
- **The dashboard signing UX doesn't exist yet** — Plan A/B/C reference `PendingActionsPanel` but never wired a real broadcaster. Phase 3 assumes we build a thin viem-based broadcaster client-side. If that's bigger than expected, fall back to the smoke script + a "paste your tx hash" form in the dashboard.
- **The `metadataURI` for IdentityRegistry.register** should ideally be IPFS or Vercel Blob. v1.5 ships with `inline://agent/<dbId>` for testnet; document the upgrade path. (Theme F may revisit for mainnet.)
- **Goldsky indexer changes** (Plan E theme B mentioned "indexer additions") are not in Plan E2 — we resolve everything via on-demand RPC receipt polling. Adding to Goldsky is a follow-up if RPC load becomes a problem.

---

## Open questions to capture during execution

1. **Does the dashboard already have a passkey-signing → broadcast pipeline?** If yes, hook into it. If no, decide whether to build it now or fall back to the smoke script for v1.5.
2. **Tier 1 wallet → Tier 1 EOA mapping** — passkey wallets are MSCAs, but `register(string)` is just an external call. The MSCA broadcasts on the builder's behalf. Confirm that flow works in the existing Circle Modular Wallet integration.
3. **Metadata URI policy** — for testnet the `inline://` URI is fine; mainnet will need real IPFS pinning. Add to Theme F backlog.

---

**Last updated:** 2026-05-12
**Status:** drafted; ready to execute Phase 1 → Phase 4 sequentially.
