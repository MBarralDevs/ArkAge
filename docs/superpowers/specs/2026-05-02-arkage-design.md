# ArkAge — v1 Protocol Design Specification

**Date:** 2026-05-02
**Status:** Approved for implementation planning
**Target chain:** Arc Testnet (chain ID `5042002`, hex `0x4CEF52`)
**Target stack:** Next.js 16 App Router on Vercel · Vercel Workflow DevKit · Neon Postgres · Circle Modular + Developer-Controlled Wallets · Claude Haiku/Sonnet/Opus 4.x

---

## Table of contents

0. [Executive Summary](#0-executive-summary)
1. [Architecture Overview](#1-architecture-overview)
2. [Smart Contracts](#2-smart-contracts)
3. [MCP Tool Surface](#3-mcp-tool-surface)
4. [Vercel Workflow Orchestration](#4-vercel-workflow-orchestration)
5. [Wallet & Policy Model](#5-wallet--policy-model)
6. [Dashboard / Explorer](#6-dashboard--explorer)
7. [Postgres Schema](#7-postgres-schema)
8. [Security, Errors & Ops](#8-security-errors--ops)
9. [Decomposition into Implementation Plans](#9-decomposition-into-implementation-plans)
10. [v1.5 / v2 Backlog](#10-v15--v2-backlog)
11. [Pre-Implementation Verification Checklist](#11-pre-implementation-verification-checklist)
12. [Glossary](#12-glossary)

---

## 0. Executive Summary

**ArkAge** is a complete agentic-commerce protocol on Arc Testnet: an **MCP server** AI agents call to transact, **5 smart contracts** that compose on top of ERC-8183 and ERC-8004, **durable workflows** that orchestrate evaluation and settlement, and a **public-by-default dashboard** that makes the agent economy legible.

**The gap ArkAge fills.** Arc has shipped the foundational primitives — ERC-8183 (job lifecycle), ERC-8004 (identity + reputation), Circle Gateway nanopayments, USDC-as-native-gas — but no opinionated, end-to-end protocol that ties them together. Existing Arc sample apps (Arc Commerce, Arc Multichain Wallet, Arc Escrow, Arc Fintech) pre-date ERC-8183 and don't address the agent-marketplace use case. Arcscan is a generic Blockscout fork with no domain-aware view of agent activity. Most x402 work on Arc to date has been DEX-flavored. ArkAge is positioned as the first reference implementation of an ERC-8183 + ERC-8004 + x402 economy on Arc.

**v1 scope (what ships):**

- **5 smart contracts** we deploy: HookComposer, ReputationHook, PolicyHook, EvaluatorFeeHook, AgentRegistry — all immutable, all plugging into ERC-8183's hook slot
- **MCP server** (~26 tools across 6 domains) for agents to bootstrap identities, post/accept/fulfill jobs, evaluate work, pay per-call via x402, and query reputation
- **4 durable workflows** in Vercel Workflow DevKit: `jobLifecycle`, `llmEvaluatorAgent` (DurableAgent), `x402PaymentSession`, `x402DisputeFlow`
- **Public dashboard** rendering the live agent economy, with builder-console gating only for destructive ops (revoke, edit policy)
- **Agent-aware overlay on Circle's x402 facilitator** — we do not build our own facilitator; we wrap Circle's with reputation gates, agentId-keyed receipts, and dispute resolution

**v1 explicitly excludes:** Arc Mainnet (not yet operational), session keys via ERC-7710 (Draft EIP, deferred to v1.5), provider-side stuck-job insurance, Safe-as-Tier-1 multisig builder wallets, premium analytics tier, ZK enhancements.

---

## 1. Architecture Overview

### 1.1 System diagram

```
                     ┌─────────────────────────────────────┐
                     │       AI agent (Claude / GPT /      │
                     │       custom — anywhere MCP runs)   │
                     └──────────────────┬──────────────────┘
                                        │ MCP over stdio/HTTP
                                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  ArkAge Next.js App (Vercel)                 │
   │ ┌────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
   │ │ MCP server     │  │ Workflow handlers│  │ Dashboard UI  │  │
   │ │ (~26 tools)    │  │ (Vercel WDK)     │  │ (App Router)  │  │
   │ └───────┬────────┘  └────────┬─────────┘  └──────┬────────┘  │
   │         │                    │                   │           │
   │ ┌───────▼────────────────────▼───────────────────▼────────┐  │
   │ │           Wallet routing resolver / Policy DB           │  │
   │ └───┬───────────────────────────────────────────┬─────────┘  │
   │     │                                           │            │
   │ ┌───▼─────────────┐                       ┌─────▼──────────┐ │
   │ │ Circle Wallets  │                       │ Anthropic API  │ │
   │ │ (Modular + DCW) │                       │ (evaluator)    │ │
   │ └───┬─────────────┘                       └────────────────┘ │
   └─────┼────────────────────────────────────────────────────────┘
         │ signs txs                              ▲
         ▼                                        │ events
   ┌─────────────────────────────────────────────┴────────────────┐
   │                     Arc Testnet (chain 5042002)              │
   │                                                              │
   │  USDC ─── ERC-8183 ─── HookComposer ──┬── PolicyHook         │
   │  ERC-8004 (Id/Rep/Validation)         ├── ReputationHook     │
   │  AgentRegistry (ours)                 └── EvaluatorFeeHook   │
   │  Circle Gateway (Wallet + Minter)                            │
   └────┬─────────────────────────────────────────────────────────┘
        │ events
        ▼
   ┌──────────────────────────────────────┐    ┌──────────────────┐
   │  Goldsky Mirror  +  Circle Contract  │───▶│  Neon Postgres   │
   │  Platform Webhooks                   │    │  (Prisma)        │
   └──────────────────────────────────────┘    └──────────────────┘
                                                      ▲
                                                      │
                            ┌─────────────────────────┘
                            │
   ┌────────────────────────┴────────────────────────┐
   │  Circle Gateway x402 Facilitator (hosted)       │
   │  + ArkAge agent-aware overlay (verify/proxy)    │
   └─────────────────────────────────────────────────┘
```

### 1.2 Component responsibilities

| Component | Responsibility | Hosted where |
|-----------|---------------|--------------|
| **MCP server** | Surface ~26 tools to agents over MCP protocol; validate inputs; route signing; trigger workflows | Next.js API routes on Vercel |
| **Workflow handlers** | Orchestrate durable, crash-resumable flows for jobs, evaluation, x402 sessions, disputes | Vercel Workflow DevKit |
| **Dashboard UI** | Public read-only views + builder-gated console | Next.js App Router on Vercel |
| **5 deployed smart contracts** | On-chain enforcement of hook composition, reputation writes, policy gates, evaluator fee splits, agent operator registration | Arc Testnet |
| **Circle Wallets** | Tier 1 Modular (passkey, MSCA), Tier 2 DCW (EOA mode), Tier 3 system DCWs | Circle infrastructure |
| **Indexing (Goldsky Mirror + Circle webhooks)** | Stream on-chain events to Postgres with sub-second latency | Managed services |
| **Postgres (Neon)** | Materialized state + append-only event log + workflow correlation + receipts | Neon |
| **x402 facilitator** | Verify EIP-3009 signatures, batch settle USDC, payouts | Circle (hosted); ArkAge wraps with agent overlay |
| **Anthropic API** | LLM evaluator (Claude Haiku/Sonnet/Opus 4.x) | Anthropic |

### 1.3 Pinned addresses & identifiers

**Arc Testnet network** (primary source: `docs.arc.network/arc/references/connect-to-arc`):

- **Chain ID:** `5042002` (hex `0x4CEF52`)
- **Gateway domain ID:** `26` (Circle Gateway internal — distinct from chain ID)
- **HTTP RPC:** `https://rpc.testnet.arc.network`
- **WebSocket RPC:** `wss://rpc.testnet.arc.network`
- **Faucet:** `https://faucet.circle.com`
- **Explorer:** `https://testnet.arcscan.app`

**Arc Testnet pinned contract addresses** (primary source: `docs.arc.network/arc/references/contract-addresses`):

| Contract | Address |
|----------|---------|
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Circle GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Circle GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| CCTP V2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| CREATE2 Factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |

**Tutorial-sourced addresses (verify pre-implementation):**

| Contract | Address | Source |
|----------|---------|--------|
| ERC-8183 AgenticCommerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` | Arc tutorial — re-verify |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Arc tutorial — re-verify |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Arc tutorial — re-verify |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | Arc tutorial — re-verify |

These four are listed in the pre-implementation verification checklist (§11).

### 1.4 Decimal conventions

- **USDC ERC-20 amounts** (job budgets, x402 payments, treasury fees, anywhere we touch token transfers): **6 decimals.** Stored in Postgres as `NUMERIC(38,0)` raw units.
- **Native gas accounting** (Arc represents native USDC gas in 18 decimals): **18 decimals.** Only relevant for gas estimation; never user-facing.

Every monetary column in the schema carries an inline comment documenting which decimals apply.

### 1.5 Stack summary

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router on Vercel |
| Workflow runtime | Vercel Workflow DevKit (`workflow` + `@workflow/ai`) |
| Database | Neon Postgres + Prisma |
| Frontend | Tailwind + shadcn/ui + framer-motion + recharts |
| Tier 1 wallet | Circle Modular Wallet (passkey, MSCA) |
| Tier 2 wallet | Circle Developer-Controlled Wallet, **EOA mode** (required for x402 nanopayments) |
| Tier 3 wallets | Circle DCW (system-owned: validator, treasury) |
| x402 SDK (buyer) | `@circle-fin/x402-batching` `GatewayClient.pay()` |
| x402 SDK (seller) | `@circle-fin/x402-batching` `createGatewayMiddleware()` |
| EIP-712 signing domain | `GatewayWalletBatched` v1 |
| Bridging (out of v1 hot path) | CCTP V2 |
| Indexer (canonical contracts) | Goldsky Mirror → Postgres |
| Indexer (our contracts) | Circle Contract Platform webhooks |
| LLM | Anthropic Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7 |
| Auth (builder dashboard) | Circle Modular passkey ceremony |
| Public dashboard | No auth required (read-only) |

---

## 2. Smart Contracts

### 2.1 Design philosophy

- **Immutable.** No proxy, no upgrade path. Bug fixes = redeploy + migrate. The complexity tax of upgrade proxies isn't worth it for a 5-contract surface; immutability is itself a security feature.
- **Hookable by design.** All extension points use ERC-8183's `IACPHook` interface so future hooks can be added without contract changes.
- **Minimal surface.** Each contract has one clear responsibility. HookComposer is a router; it holds no funds, makes no decisions.
- **Standard-compliant.** ReputationHook explicitly implements the optional ERC-8183 §"Reputation / Attestation Interop (ERC-8004)" extension pattern. We are not bending the standard.
- **Funds-safe.** No contract holds user funds beyond what ERC-8183 already escrows. EvaluatorFeeHook splits at settlement; ReputationHook never touches funds.

### 2.2 Contract catalog

| # | Contract | Type | Holds funds? | Owns 8004 NFTs? |
|---|----------|------|--------------|-----------------|
| 1 | **HookComposer** | `IACPHook` router | No | No |
| 2 | **ReputationHook** | `afterAction` writer to ERC-8004 | No | No |
| 3 | **PolicyHook** | `beforeAction` gate against AgentRegistry | No | No |
| 4 | **EvaluatorFeeHook** | `afterAction` token split at settlement | No (transient only) | No |
| 5 | **AgentRegistry** | Per-agent operator + policy hash mapping | No | No |

**Universal invariant (Risk #1 resolution):** None of the five contracts will ever own or be approved-operator of an ERC-8004 identity NFT. Verified via:
- No contract has a function that calls `IIdentityRegistry.approve()` for itself
- No contract is referenced as a recipient in any `transferFrom` of an 8004 NFT
- Deploy script asserts `ownerOf(any test agentId) != contractAddress`

### 2.3 HookComposer

**Purpose:** Chain multiple hook contracts together so a single ERC-8183 job can be governed by PolicyHook (`beforeAction`) and ReputationHook + EvaluatorFeeHook (`afterAction`) simultaneously.

```solidity
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}

contract HookComposer is IACPHook, ERC165 {
    address public immutable AGENTIC_COMMERCE;
    address[] public beforeHooks;  // ordered: PolicyHook
    address[] public afterHooks;   // ordered: EvaluatorFeeHook (must run before ReputationHook),
                                   //          ReputationHook
    
    constructor(address acp, address[] memory _before, address[] memory _after) { ... }
    
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        for (uint i = 0; i < beforeHooks.length; i++) {
            IACPHook(beforeHooks[i]).beforeAction(jobId, selector, data);
        }
    }
    
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        for (uint i = 0; i < afterHooks.length; i++) {
            IACPHook(afterHooks[i]).afterAction(jobId, selector, data);
        }
    }
}
```

**Ordering note:** EvaluatorFeeHook must run before ReputationHook in the `afterHooks` array so the fee split is observable in the same transaction's state but reputation is the last write. If EvaluatorFeeHook reverts, ReputationHook is not called — desired behavior (no reputation entry for a failed payout).

### 2.4 ReputationHook

**Purpose:** On `complete` or `reject`, automatically write feedback to ERC-8004 ReputationRegistry on behalf of the buyer/evaluator, with the off-chain evidence hash threaded through.

```solidity
contract ReputationHook is IACPHook, ERC165 {
    address public immutable AGENTIC_COMMERCE;
    address public immutable REPUTATION_REGISTRY;  // 0x8004B6...
    address public immutable AGENT_REGISTRY;       // ours
    
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        
        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        uint256 providerAgentId = IAgentRegistry(AGENT_REGISTRY).agentIdByOperator(job.provider);
        if (providerAgentId == 0) return;  // unknown provider — skip silently
        
        if (selector == IACP.complete.selector) {
            IReputationRegistry(REPUTATION_REGISTRY).giveFeedback(
                providerAgentId,
                int128(100), uint8(0),
                "src:acp", "outcome:complete",
                _jobEndpoint(jobId),
                _evidenceURI(job.reason),
                job.reason
            );
        } else if (selector == IACP.reject.selector) {
            IReputationRegistry(REPUTATION_REGISTRY).giveFeedback(
                providerAgentId,
                int128(-50), uint8(0),
                "src:acp", "outcome:reject",
                _jobEndpoint(jobId),
                _evidenceURI(job.reason),
                job.reason
            );
        }
    }
    
    function beforeAction(uint256, bytes4, bytes calldata) external {}
}
```

**Why this is ERC-8004-compliant** (Risk #1 resolution):

ERC-8004 spec says: *"The feedback submitter MUST NOT be the agent owner or an approved operator for `_agentId_`."* `msg.sender` from ERC-8004's perspective is the ReputationHook contract address. ReputationHook never owns or is approved-operator of any 8004 identity (universal invariant in §2.2). ✓ compliant.

ERC-8183 spec §"Reputation / Attestation Interop (ERC-8004)" explicitly recommends this pattern: *"Hooks MAY be used to call into ERC-8004 registries in `afterAction` for `complete`/`reject`."*

**`reason` field threading:** The `bytes32 reason` passed to `complete`/`reject` is the keccak256 hash of the canonical evaluator output JSON (stored in Vercel Blob, indexed in Postgres). The same hash is passed as `feedbackHash` to `giveFeedback`. Anyone reading the on-chain reputation event can fetch the off-chain evaluator output and verify the hash matches.

### 2.5 PolicyHook

**Purpose:** On any hookable `beforeAction`, look up the calling agent's policy in AgentRegistry and reject the action if it violates per-tx caps, contract allowlist, counterparty deny-list, or the active flag.

```solidity
contract PolicyHook is IACPHook, ERC165 {
    address public immutable AGENTIC_COMMERCE;
    address public immutable AGENT_REGISTRY;
    
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        
        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        address actingOperator = _resolveActor(selector, job, data);
        
        IAgentRegistry.AgentInfo memory info = IAgentRegistry(AGENT_REGISTRY)
            .agentByOperator(actingOperator);
        
        require(info.active, "policy: agent inactive");
        
        if (selector == IACP.fund.selector) {
            uint256 fundAmount = abi.decode(data, (uint256));
            require(fundAmount <= info.perTxCap, "policy: per-tx cap");
        }
        
        // additional gates as enumerated in policy on-chain encoding
    }
    
    function afterAction(uint256, bytes4, bytes calldata) external {}
}
```

**Off-chain ↔ on-chain split:** Stateful rules (rolling daily caps, rate limits) live in the off-chain MCP server's policy DB; stateless rules (per-tx caps, contract allowlist, counterparty deny-list, active flag) live in PolicyHook. **Both must approve** for the action to succeed — defense in depth.

### 2.6 EvaluatorFeeHook

**Purpose:** On `complete`, redirect a portion of the escrowed budget to the ArkAge Treasury wallet as the evaluator fee, before the remainder flows to the provider.

```solidity
contract EvaluatorFeeHook is IACPHook, ERC165 {
    address public immutable AGENTIC_COMMERCE;
    address public immutable USDC;
    address public immutable TREASURY;
    address public immutable AGENT_REGISTRY;
    
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external {
        require(msg.sender == AGENTIC_COMMERCE, "only ACP");
        if (selector != IACP.complete.selector) return;
        
        IACP.Job memory job = IACP(AGENTIC_COMMERCE).getJob(jobId);
        uint256 fee = IAgentRegistry(AGENT_REGISTRY).evaluatorFeeFor(jobId);
        if (fee == 0) return;  // BYO evaluator — no ArkAge fee
        
        // Provider has already been credited the full budget by ACP.
        // We pull the fee back from the provider's wallet via prior approval.
        IERC20(USDC).transferFrom(job.provider, TREASURY, fee);
    }
    
    function beforeAction(uint256, bytes4, bytes calldata) external {}
}
```

**Fee recording:** Happens at `fund_job` time, not at `post_job` time, because percentage fees require the provider's budget (set via `setBudget` between create and fund). The MCP server batches `IACP.fund(jobId, ...)` with `AgentRegistry.recordJobFee(jobId, fee)` via Multicall3 from the client's Tier 2 wallet. This freezes the fee. EvaluatorFeeHook reads it via `evaluatorFeeFor(jobId)` at settlement. See §3.3 `post_job` notes for full flow.

**Approval mechanism:** When a provider accepts a job (calls `setBudget`), the MCP server requires them to also approve EvaluatorFeeHook for at most the maximum fee they could owe (`evaluatorFeeMax`). Without this approval, the `transferFrom` reverts and the entire `complete` reverts — ensuring fees are always collected when due.

**Fee tier mapping** (configurable in AgentRegistry per-agent or system-default):

| Tier | Model | Fee | Cap |
|------|-------|-----|-----|
| `fast` | Claude Haiku 4.5 | $0.10 flat or 5% (max) | — |
| `standard` | Claude Sonnet 4.6 | 2% | $1.00 |
| `premium` | Claude Opus 4.7 | 1% | $5.00 |

Clients select tier at job posting (`evaluator_tier` in the job metadata). BYO evaluator: client passes a non-ArkAge address as ERC-8183's `evaluator` parameter; EvaluatorFeeHook returns early.

### 2.7 AgentRegistry

**Purpose:** Map ERC-8004 agent identities to their current Tier 2 operator wallet, current policy hash, evaluator fee config, and active flag. Owned by the ERC-8004 identity owner.

```solidity
contract AgentRegistry {
    address public immutable IDENTITY_REGISTRY;  // 0x8004A8...
    
    struct AgentInfo {
        address operatorWallet;       // Tier 2 DCW EOA
        bytes32 currentPolicyHash;    // keccak256 of canonical policy JSON
        uint128 perTxCap;             // USDC raw units (6 decimals)
        uint64 evaluatorFeeMax;       // upper bound on evaluator fee
        bool active;
    }
    
    address public immutable AGENTIC_COMMERCE;  // ERC-8183 contract
    
    mapping(uint256 agentId => AgentInfo) public agents;
    mapping(address operator => uint256 agentId) public agentIdByOperator;
    
    // Per-job evaluator fee, set once by the job's client during post_job and frozen.
    mapping(uint256 jobId => uint256 fee) public jobEvaluatorFees;
    mapping(uint256 jobId => bool) public jobFeeRecorded;
    
    modifier onlyIdentityOwner(uint256 agentId) {
        require(IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId) == msg.sender,
                "not identity owner");
        _;
    }
    
    function registerAgent(uint256 agentId, address op, bytes32 policy,
                           uint128 perTx, uint64 evalFeeMax) external onlyIdentityOwner(agentId);
    function updateOperator(uint256 agentId, address op) external onlyIdentityOwner(agentId);
    function updatePolicy(uint256 agentId, bytes32 policy, uint128 perTx, uint64 evalFeeMax)
        external onlyIdentityOwner(agentId);
    function deactivate(uint256 agentId) external onlyIdentityOwner(agentId);
    function reactivate(uint256 agentId) external onlyIdentityOwner(agentId);
    
    // Records the agreed evaluator fee for a specific job. Set-and-freeze:
    //   - MUST be called by the job's client (verified via IACP.getJob(jobId).client)
    //   - MUST NOT be already set (jobFeeRecorded[jobId] = false)
    //   - fee MUST be ≤ client agent's evaluatorFeeMax
    //   - fee MUST be 0 if the job uses BYO evaluator (job.evaluator != ArkAge validator)
    function recordJobFee(uint256 jobId, uint256 fee) external;
    
    function agentByOperator(address op) external view returns (AgentInfo memory);
    function evaluatorFeeFor(uint256 jobId) external view returns (uint256);
}
```

**Why owner-gated, not ArkAge-gated:** Builders retain ownership of their agents. ArkAge cannot revoke or modify any agent's operator/policy without the builder's Tier 1 signature. This is the load-bearing non-custodial guarantee for identity & governance, even though the operator wallet itself is ArkAge-custodial.

### 2.8 Hook composition diagram

```
          ┌─────────────────────────────────┐
          │  ERC-8183 AgenticCommerce       │
          │  (canonical, 0x0747EEf0…)       │
          └──────────────┬──────────────────┘
                         │ calls hook on every action
                         ▼
          ┌─────────────────────────────────┐
          │  HookComposer (ours)            │
          │  job.hook = HookComposer        │
          └──────┬─────────────────┬────────┘
                 │ before          │ after
                 ▼                 ▼
        ┌────────────────┐  ┌─────────────────────┐
        │  PolicyHook    │  │  EvaluatorFeeHook   │
        │  (gates)       │  │  (USDC split)       │
        └───────┬────────┘  └──────────┬──────────┘
                │                      ▼
                │             ┌─────────────────────┐
                │             │  ReputationHook     │
                │             │  (writes to 8004)   │
                │             └──────────┬──────────┘
                ▼                        ▼
      ┌─────────────────┐    ┌────────────────────────┐
      │ AgentRegistry   │    │ ERC-8004 Reputation    │
      │ (ours)          │    │ Registry (0x8004B6…)   │
      └─────────────────┘    └────────────────────────┘
```

### 2.9 Deployment notes

- All contracts deployed via deterministic CREATE2 from the standard factory (`0x4e59…956C`) so addresses are stable across testnet/mainnet
- All contracts verified on `testnet.arcscan.app` post-deploy
- AgentRegistry deployed first (others reference it as immutable constructor arg)
- HookComposer deployed last (references the others)
- Foundry test suite ≥95% line / ≥85% branch coverage required pre-deploy
- Slither + Mythril clean before mainnet (testnet may ship with un-addressed low-severity findings if documented)
- External audit required before mainnet, not testnet

---

## 3. MCP Tool Surface

### 3.1 Design philosophy

- **Tools, not endpoints.** Every MCP tool is a single coherent action an agent can take. No "do everything" tools, no implicit orchestration.
- **Idempotent where possible.** Tools that mutate on-chain or workflow state accept an `idempotencyKey` and return the existing result if called twice.
- **Schema-first.** Every tool defines a Zod input schema; outputs are typed Result envelopes with discriminated success/error variants.
- **Wallet-aware.** Tools never expose raw private keys. The wallet routing resolver picks the appropriate Tier (1/2/3) wallet based on the action.
- **Workflow-triggering, not workflow-internal.** MCP tools may *trigger* workflows but never run inside one.

### 3.2 Tool domains (6)

| Domain | Tools | Purpose |
|--------|-------|---------|
| **Wallet & Identity** | `bootstrap_user`, `get_agent_info`, `update_agent_metadata`, `revoke_agent`, `get_my_agents` | Lifecycle of builder + agent identities |
| **ERC-8183 Jobs** | `post_job`, `accept_job`, `set_budget`, `fund_job`, `submit_work`, `claim_refund`, `get_job`, `list_jobs`, `query_jobs` | Full job lifecycle |
| **x402 Payments** | `pay_and_call`, `register_x402_endpoint`, `list_my_x402_endpoints`, `list_my_x402_receipts`, `dispute_receipt` | Buyer + seller side x402 |
| **Treasury & Settlement** | `get_treasury_position`, `withdraw_treasury` (admin) | ArkAge fee tracking |
| **Reputation** | `get_reputation`, `query_reputation_history`, `compare_agents` | 8004 reads with domain context |
| **Health & Admin** | `get_protocol_health`, `force_advance_workflow` (auth-gated), `verify_evidence` | Operational tooling |

Total: ~26 tools (final count flexes during implementation as some compose).

### 3.3 Deep specs on key tools

#### `bootstrap_user`

```ts
input: {
  mode: "passkey-builder+dcw-agent" | "dcw-only" | "passkey-only";
  agentMetadata: {
    name: string;
    description: string;
    capabilities: string[];
    version: string;
  };
  initialPolicy?: AgentPolicy;  // see §5.2
  evaluatorTier?: "fast" | "standard" | "premium";  // default "standard"
  idempotencyKey: string;
}

output: {
  builderWalletAddress: Address;
  agentIdentityId: bigint;
  agentOperatorWallet: Address;
  policyVersion: number;
  policyHash: Hex;
  gatewayDepositTx?: Hex;  // present if Tier 2 EOA deposit was made
}
```

**Steps for default mode** (per §5.5):
1. Browser passkey ceremony → Circle Modular Wallet for builder (Tier 1)
2. ArkAge creates DCW for agent in **EOA mode** (Tier 2)
3. ArkAge mints ERC-8004 identity NFT, transfers to Tier 1 in same op
4. ArkAge writes initial policy JSON to Postgres, computes canonical hash
5. Builder signs `AgentRegistry.registerAgent(agentId, dcwAddress, policyHash, perTxCap, evalFeeMax)` from Tier 1
6. ArkAge sets `agentWallet` metadata in 8004 to point at the Tier 2 DCW EOA
7. **One-time Gateway deposit:** Tier 2 EOA calls `client.deposit(initialAmount)` to fund the Gateway Wallet for x402 payments. ArkAge funds the gas for this single tx.
8. Returns identifiers

#### `post_job`

```ts
input: {
  asAgent: bigint;
  provider?: Address;        // omitted = open to any provider
  evaluator: Address;        // ArkAge validator wallet OR a BYO evaluator EOA
  evaluatorTier?: "fast" | "standard" | "premium";  // ignored if BYO
  expiredAtSec: number;      // unix timestamp
  description: string;
  attachments?: { uri: string; hash: Hex }[];
  budgetMin?: bigint;        // optional cap on what providers can setBudget
  hook: Address;             // typically ArkAge HookComposer address
  idempotencyKey: string;
}

output: { jobId: bigint; createTx: Hex; workflowRunId: string }
```

Calling `post_job`:
1. Validates agent ownership and policy
2. Routes to Tier 2 wallet for signing
3. Calls `IACP.createJob(provider, evaluator, expiredAtSec, descriptionURI, hook)` on Arc; `descriptionURI` metadata includes the chosen `evaluatorTier`
4. Spawns `jobLifecycle(jobId)` workflow
5. Records denormalized state in `jobs` table (`evaluator_tier` set, `evaluator_fee` NULL until fund time); events flow in via indexer

**Fee recording happens at fund time.** Percentage fees can't be computed until the provider has set the budget. The `fund_job` tool (not deeply spec'd here) computes the actual fee from `evaluatorTier` + budget per §2.6's fee tier mapping, then issues a Multicall3 batching `IACP.fund(jobId, ...)` + `AgentRegistry.recordJobFee(jobId, fee)` from the client's Tier 2 wallet. `recordJobFee`'s on-chain check verifies `msg.sender == IACP(AGENTIC_COMMERCE).getJob(jobId).client` and that no fee was previously recorded.

#### `pay_and_call`

```ts
input: {
  asAgent: bigint;
  url: string;
  maxPrice: bigint;            // hard cap; reject if 402 demands more
  expectedSeller?: Address;    // optional pinning
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
  idempotencyKey: string;
}

output: { 
  status: number;
  body: unknown;
  receiptId: string;
  amountPaid: bigint;
  sessionId: string;
}
```

Implementation:
1. Resolves Tier 2 EOA via wallet routing
2. Constructs `GatewayClient` from `@circle-fin/x402-batching` keyed to the Tier 2 EOA
3. Calls `client.pay(url, { maxPrice, headers, body })`
4. SDK handles: initial GET → receive 402 → sign EIP-3009 against `GatewayWalletBatched` domain → retry with `PAYMENT-SIGNATURE` header
5. ArkAge wraps: validates 402 response declares an ArkAge-registered seller (if `expectedSeller` set), checks reputation gate, opens or joins an `x402PaymentSession` workflow for the (buyer, seller) pair, persists receipt
6. Returns response + receipt metadata

#### `register_x402_endpoint`

```ts
input: {
  asAgent: bigint;
  url: string;
  pricePerCall: bigint;       // USDC raw units (6 decimals)
  hosting: "self" | "arkage-proxy";
  schema?: object;            // optional OpenAPI/JSON-Schema for the endpoint
  idempotencyKey: string;
}

output: { endpointId: string; effectiveURL: string }
```

For `hosting: "self"`: the seller runs their own Express server with `createGatewayMiddleware()`. ArkAge records the endpoint, listens for receipts via Goldsky/webhook. `effectiveURL` = the seller's URL.

For `hosting: "arkage-proxy"`: ArkAge runs a Vercel Function as a proxy. Buyer calls ArkAge's URL → ArkAge runs the Gateway middleware → on payment verification, forwards to seller's actual implementation. `effectiveURL` = `https://arkage.network/x402/{endpointId}`. Eases adoption for sellers who don't want to run their own server.

#### `evaluate_job`

```ts
input: {
  jobId: bigint;
  asAgent: bigint;             // must be the evaluator address registered on the job
  tier?: "fast" | "standard" | "premium";  // overrides default
  systemPromptOverride?: string;
  idempotencyKey: string;
}

output: {
  workflowRunId: string;       // child workflow that runs the evaluator
  estimatedCompletionSec: number;
}
```

Triggers `llmEvaluatorAgent(jobId, tier)` workflow. Returns immediately with the run ID; the actual evaluation happens asynchronously, with results streamed to the dashboard's job-detail view via the workflow's writable.

#### `verify_evidence`

```ts
input: {
  jobId: bigint;
}

output: {
  onChainReasonHash: Hex;
  fetchedEvidenceURI: string;
  fetchedEvidenceContent: object;
  computedHash: Hex;
  matches: boolean;
  evaluatorMetadata: { model: string; tier: string; tokens: { input: number; output: number } };
}
```

Public verification tool — anyone (no auth) can call this for any settled job to confirm the on-chain attestation hash matches the off-chain evaluator output stored in Vercel Blob.

### 3.4 Tool naming distinction

All ArkAge MCP tools live under the `arkage:*` namespace in MCP discovery to clearly distinguish from the existing **Arc MCP Server** (Arc's official MCP for AI-assisted development of Arc apps). The two are complementary, not competing — Arc's MCP helps developers build Arc applications; ArkAge's MCP helps agents transact within an Arc-deployed economy.

---

## 4. Vercel Workflow Orchestration

### 4.1 Workflow catalog

| # | Workflow | Trigger | Lifetime | Purpose |
|---|----------|---------|----------|---------|
| 1 | `jobLifecycle(jobId)` | `post_job` MCP tool | minutes – `expiredAt` | Drives a job from Funded → terminal state |
| 2 | `llmEvaluatorAgent(jobId, tier)` | child of `jobLifecycle` | seconds – minutes | Claude DurableAgent grades work |
| 3 | `x402PaymentSession(buyerAgentId, sellerAgentId)` | first `pay_and_call` between a pair | minutes – idle timeout | Tracks session lifecycle, enforces reputation gates, detects disputes |
| 4 | `x402DisputeFlow(receiptId)` | `dispute_receipt` MCP tool | minutes – days | Evidence collection + auto-resolution + manual escalation |

Plus 3 supporting cron-triggered jobs (not workflows in the WDK sense, but Vercel Cron functions):

- **Indexer reconciliation cron** (every 5 min) — backstop for any missed Goldsky/webhook events
- **Stuck-job reconciler cron** (every 5 min) — scans Postgres for workflows whose `last_advanced_at > 10 min`, force-advances via chain-state query
- **Treasury reconciliation cron** (hourly) — checks Circle Gateway batch settlements, updates `treasury_movements` table

### 4.2 Cross-cutting patterns

**(a) Self-rescue race for every chain-event await.**

```ts
async function awaitChainEvent<T>(
  hookToken: string,
  expectedStateOnChain: () => Promise<boolean>,
  expiredAtSec: number
): Promise<{ kind: "event"; payload: T } | { kind: "rescued" } | { kind: "expired" }> {
  "use workflow";
  
  const hook = createHook<T>({ token: hookToken });
  
  while (true) {
    const winner = await Promise.race([
      hook,
      sleep("60s"),
      sleep(`${Math.max(0, expiredAtSec - Math.floor(Date.now() / 1000))}s`)
    ]);
    
    if (winner && typeof winner === "object") return { kind: "event", payload: winner as T };
    
    if (Date.now() / 1000 >= expiredAtSec) return { kind: "expired" };
    
    if (await expectedStateOnChain()) return { kind: "rescued" };
    // else loop — sleep won, state hasn't advanced, expiry not reached
  }
}
```

Every workflow await on a chain event uses this pattern. Three independent ways to advance: indexer push (fast), workflow self-poll (medium), expiry (terminal). Risk #2's primary mitigation.

**(b) Deterministic hook tokens.**

| Event source | Token format |
|--------------|-------------|
| ERC-8183 JobFunded | `8183:JobFunded:{jobId}` |
| ERC-8183 JobSubmitted | `8183:JobSubmitted:{jobId}` |
| ERC-8183 JobCompleted | `8183:JobCompleted:{jobId}` |
| ERC-8183 JobRejected | `8183:JobRejected:{jobId}` |
| ERC-8004 FeedbackGiven | `8004:Feedback:{txHash}:{logIndex}` |
| Evaluator child workflow done | `evaluator:{jobId}:done` |
| x402 receipt | `x402:Receipt:{sessionId}:{seq}` |

Both indexer push path and rescue cron use the same tokens. Resume is naturally idempotent: a hook can only be resolved once (single-await), so duplicate `resumeHook` calls are no-ops.

**(c) `reason` field threading.**

The `bytes32 reason` parameter on ERC-8183's `complete`/`reject` is computed as `keccak256(canonicalize(evaluatorOutput))`. The full evaluator output (model, prompt hash, deliverable hash, reasoning, structured response, verdict, score) is persisted to:
- Vercel Blob at `evidence/{jobId}/{evaluatorRunId}.json` (private)
- Postgres `job_evaluations` table

The same hash is passed to `ReputationHook` → `giveFeedback(_, _, _, _, _, _, _, feedbackHash=reason)`, creating one immutable cryptographic link between off-chain evaluation, on-chain settlement, and on-chain reputation.

**(d) Wallet routing.**

Every workflow step that signs a tx routes through the wallet resolver (§5.4). PolicyHook on-chain enforces the same rules the resolver enforces off-chain. **Both must approve.**

### 4.3 `jobLifecycle(jobId)` deep spec

```ts
export async function jobLifecycle(jobId: bigint, expiredAtSec: number) {
  "use workflow";
  
  await recordWorkflowStart(jobId, "job_lifecycle");
  
  // Phase 1: wait for funding (job posted but not yet funded)
  const funded = await awaitChainEvent<JobFundedEvent>(
    `8183:JobFunded:${jobId}`,
    async () => (await readJobState(jobId)) === "Funded" || isPastFunded(jobId),
    expiredAtSec
  );
  if (funded.kind === "expired") return { outcome: "expired_unfunded" };
  await recordWorkflowAdvance(jobId, "funded");
  
  // Phase 2: wait for submission
  const submitted = await awaitChainEvent<JobSubmittedEvent>(
    `8183:JobSubmitted:${jobId}`,
    async () => (await readJobState(jobId)) === "Submitted" || isPastSubmitted(jobId),
    expiredAtSec
  );
  if (submitted.kind === "expired") {
    await tryClaimRefundForBuyer(jobId);  // step
    return { outcome: "expired_unsubmitted_refunded" };
  }
  await recordWorkflowAdvance(jobId, "submitted");
  
  // Phase 3: spawn evaluator child (only if ArkAge is the evaluator)
  if (await isArkAgeEvaluator(jobId)) {
    const evalRunId = await startEvaluatorChild(jobId);  // step wraps start()
    
    const evalDone = await awaitChainEvent<JobTerminalEvent>(
      `evaluator:${jobId}:done`,
      async () => isJobTerminal(jobId),
      expiredAtSec
    );
    if (evalDone.kind === "expired") {
      await tryClaimRefundForBuyer(jobId);
      return { outcome: "expired_unevaluated_refunded" };
    }
  }
  // BYO evaluator: just wait for terminal state
  
  // Phase 4: wait for terminal state if not already
  const terminal = await awaitChainEvent<JobTerminalEvent>(
    `8183:JobTerminal:${jobId}`,
    async () => isJobTerminal(jobId),
    expiredAtSec
  );
  
  await recordWorkflowComplete(jobId, terminal.kind);
  return { outcome: jobTerminalLabel(terminal) };
}
```

### 4.4 `llmEvaluatorAgent(jobId, tier)` deep spec

```ts
export async function llmEvaluatorAgent(jobId: bigint, tier: "fast" | "standard" | "premium") {
  "use workflow";
  
  const job = await loadJobContext(jobId);  // step
  const deliverable = await fetchDeliverable(job.deliverableURI);  // step
  
  const model = pickModel(tier);  // "anthropic/claude-haiku-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-7"
  
  const agent = new DurableAgent({
    model,
    system: EVALUATOR_SYSTEM_PROMPT_V1,
    tools: {
      fetchExternalData: { ... },
      checkReputationOnChain: { ... },
    }
  });
  
  const result = await agent.stream({
    messages: [{ 
      role: "user",
      content: buildEvaluationPrompt(job, deliverable)
    }],
    writable: getWritable<UIMessageChunk>({ namespace: "evaluator:reasoning" }),
    maxSteps: 12
  });
  
  const verdict = parseVerdict(result.messages);  // step
  const evidenceHash = await persistEvidence(jobId, result, verdict);  // step
  
  if (verdict.decision === "accept") {
    await callComplete(jobId, evidenceHash);  // step — uses Tier 3 validator wallet
  } else {
    await callReject(jobId, evidenceHash);    // step
  }
  
  await resumeHook(`evaluator:${jobId}:done`, { verdict, evidenceHash });  // step
  return { verdict, evidenceHash };
}
```

**Streaming:** the agent's reasoning streams to the `evaluator:reasoning` namespace so the dashboard's job detail page can render it live via SSE.

### 4.5 `x402PaymentSession(buyerAgentId, sellerAgentId)` deep spec

```ts
export async function x402PaymentSession(buyerAgentId: bigint, sellerAgentId: bigint) {
  "use workflow";
  
  await openSession(buyerAgentId, sellerAgentId);  // step
  
  const hook = createHook<ReceiptEvent | CloseEvent>({
    token: `x402:Session:${buyerAgentId}:${sellerAgentId}`
  });
  
  for await (const event of hook) {
    if (event.kind === "close") break;
    
    await persistReceipt(event.receipt);  // step
    
    // Reputation check on every Nth receipt (configurable)
    if (event.receipt.seq % 10 === 0) {
      const sellerOk = await checkSellerReputation(sellerAgentId);
      if (!sellerOk) {
        await markSessionAsRiskGated(buyerAgentId, sellerAgentId);
        break;
      }
    }
  }
  
  await closeSession(buyerAgentId, sellerAgentId);  // step
  // Note: we do NOT settle on-chain here — Circle's facilitator batches it
}
```

**Key design constraint resolved:** This workflow does NOT do batched settlement orchestration. Circle Gateway's TEE-backed batched settlement handles that. Our session is for **agent-pair lifecycle, reputation gating, dispute detection, and dashboard analytics** — observability and policy, not money movement.

Sessions auto-close after 30 min of inactivity (sleep timer racing the hook).

### 4.6 `x402DisputeFlow(receiptId)` deep spec

Triggered when a buyer calls `dispute_receipt`. Steps:
1. Pull facilitator-side logs for the receipt (step)
2. Pull our own proxy logs if `arkage-proxy` hosting
3. Re-attempt the call to determine if it was deterministically broken
4. Auto-resolve common cases: timeout → refund; 4xx persistent → no refund; 5xx persistent → refund
5. Edge cases → flag for manual review in admin dashboard

### 4.7 Indexing infrastructure

**For the four canonical contracts** (USDC, ERC-8183, ERC-8004 ×3): **Goldsky Mirror** streams events directly to Postgres `*_events` tables with sub-second latency. Goldsky Mirror confirmed available on Arc Testnet (slug `arc-testnet`). Pricing TBD pre-implementation.

**For our 5 deployed contracts:** **Circle Contract Platform webhooks** push events to a Vercel webhook route (`/api/webhooks/circle`) which writes to Postgres and fires `resumeHook` for any matching workflow tokens. Webhooks recommended over polling per Circle docs.

**Reconciliation cron** (every 5 min, Vercel Cron): scans `workflow_runs` for entries where `status = 'running' AND last_advanced_at < now() - interval '10 minutes'`. For each, queries chain state via viem, fires synthesized `resumeHook` if state has drifted. Belt-and-suspenders backup to (a) Goldsky/webhooks and (b) the workflow self-rescue race.

### 4.8 Workflow error handling

- **`RetryableError`** for transient failures (RPC blip, Anthropic 5xx, Neon connection drop). Default exponential backoff with jitter, max 5 attempts.
- **`FatalError`** reserved for invariant violations (e.g., unexpected contract revert with unknown reason, schema mismatch). Workflow ends in failure; on-call paged via Sentry.
- Every step that mutates external state attaches a deterministic `idempotencyKey` (e.g., `complete:${jobId}:v1`) so retries don't double-submit.

---

## 5. Wallet & Policy Model

### 5.1 Wallet topology (3 tiers + system wallets)

| Tier | Wallet type | Owner | Custody | x402-capable? | Used for |
|------|-------------|-------|---------|---------------|----------|
| **1** | Circle Modular (passkey, MSCA) | Builder (human) | Non-custodial | No (SCA, incompatible with x402) | Owns 8004 NFTs; high-value tx; policy issuance/revocation; recovery |
| **2** | Circle DCW in **EOA mode** | ArkAge entity (logical builder) | Custodial within policy | **Yes** | All autonomous agent actions: 8183 calls, x402 payments, submit/complete |
| **3a** | `arkage:validator` DCW | ArkAge | System | n/a | Signs `validationResponse` and evaluator's `complete`/`reject` |
| **3b** | `arkage:treasury` DCW | ArkAge | System | n/a | Receives evaluator fees, x402 surcharges, refunds |
| **3c** | `arkage:gas-funder` DCW | ArkAge | System | n/a | Funds one-time gas for Tier 2 EOA Gateway deposits |

**Critical constraint** (LBC-1 from research): Tier 2 wallets must be DCWs in EOA mode. Circle Gateway nanopayments verify signatures via `ecrecover` and do not support EIP-1271 contract signatures. Tier 1 stays SCA because ERC-8183 itself doesn't care, and SCA gives us passkey UX for builders.

### 5.2 Policy schema

```ts
type AgentPolicy = {
  schemaVersion: 1;
  agentId: bigint;
  version: number;             // monotonic
  validFrom: number;           // unix sec
  validTo: number | null;      // null = open-ended; revocation = set to now
  
  spendCaps: {
    perTx: bigint;             // USDC raw units (6 decimals)
    perDay: bigint;
    perWeek: bigint;
  };
  
  allowedContracts: Address[]; // contract address allowlist
  allowedSelectors: Hex[];     // 4-byte function selectors
  
  counterpartyRules: {
    minReputation: number | null;
    allowList: Address[];
    denyList: Address[];
  };
  
  rateLimits: {
    jobsPerHour: number;
    x402CallsPerMinute: number;
  };
  
  tokens: Address[];           // default [USDC]; can extend
  
  evaluatorPreferences: {
    defaultTier: "fast" | "standard" | "premium";
    maxFeePerJob: bigint;
  };
};
```

Canonical hash = `keccak256(JSON.stringify(canonicalize(policy)))` where canonicalize sorts keys deterministically.

### 5.3 PolicyHook ↔ Off-chain split

| Rule | On-chain (PolicyHook) | Off-chain (MCP server) |
|------|----------------------|------------------------|
| Active flag | ✓ | ✓ |
| Per-tx cap | ✓ | ✓ |
| Allowed contracts | ✓ | ✓ |
| Counterparty deny-list | ✓ | ✓ |
| Per-day spend cap (rolling) | ✗ (state-heavy) | ✓ |
| Per-week spend cap (rolling) | ✗ | ✓ |
| Rate limits | ✗ | ✓ |
| Min reputation gate | ✗ | ✓ |
| Counterparty allow-list | ✗ | ✓ |

**Both must approve.** Off-chain rejects are fast UX (returned in tool response). On-chain rejects are the trust boundary (revert observed in tx).

### 5.4 Wallet routing resolver

Pure function inside MCP server:

```ts
type RoutingDecision =
  | { wallet: "tier1-modular"; reason: "high-value" | "identity-op" | "recovery" }
  | { wallet: "tier2-dcw"; policyVersion: number; policyHash: Hex }
  | { wallet: "tier3-validator" }
  | { wallet: "tier3-treasury" }
  | { wallet: "tier3-gas-funder" }
  | { reject: true; reason: string };

function route(action: ToolCall, context: Context): RoutingDecision { ... }
```

Priority order:
1. ERC-8004 identity ops (transfer, burn) → Tier 1
2. Treasury withdrawals → Tier 3 Treasury
3. Evaluator settlement (`complete`/`reject` from ArkAge) → Tier 3 Validator
4. Gateway deposit during bootstrap → Tier 3 Gas-Funder pays gas, Tier 2 EOA signs
5. Action exceeds per-tx cap → Tier 1 (require passkey) OR reject (per-builder config)
6. Action exceeds rate limit → reject with `Retry-After`
7. Action against denied counterparty → reject
8. Otherwise → Tier 2 with current policy version + hash attached to call data

### 5.5 `bootstrap_user` flow (default mode)

Already specified in §3.3. Eight steps, three user-visible interactions: initial passkey ceremony, mode confirmation, final approval of `registerAgent` tx.

### 5.6 Recovery & revocation

| Scenario | Path | RTO |
|----------|------|-----|
| Builder loses passkey | Circle Modular's BIP-39 mnemonic recovery (collected at bootstrap, builder stores offline) | depends on builder |
| Suspected Tier 2 compromise | Dashboard "revoke agent" → `AgentRegistry.deactivate(agentId)` from Tier 1 → MCP server immediately rejects all calls for that agentId. Optional sweep of Tier 2 funds → Tier 1. | < 1 min |
| Rotate Tier 2 wallet | `AgentRegistry.updateOperator(agentId, newDcw)` from Tier 1, new DCW provisioned, in-flight workflows finish on old wallet (idempotent) | < 5 min |
| ArkAge entity secret confirmed leak | All Tier 2/3 wallets paused; rotation runbook executed; builders re-authorize new operator wallets via Tier 1 signature | 4 hours |
| PolicyHook rejects legitimate action | Builder updates policy from Tier 1 to widen rule, re-attempts | < 2 min |
| Stuck workflow / can't reach Tier 1 | Public dashboard "force advance" button (read-only chain query, can't sign) | < 1 min |

### 5.7 Security guarantees

- **Tier 1 is non-custodial.** ArkAge cannot sign on builder's behalf, full stop. Loss of passkey + loss of mnemonic = loss of access (standard Web3 risk, surfaced at bootstrap).
- **Tier 2 is custodial *bounded by policy*.** Worst-case if ArkAge entity secret leaks: attacker can drain Tier 2 wallets up to per-tx caps within the contract allowlist. Cannot: (a) move funds outside allowlisted contracts, (b) bypass on-chain PolicyHook checks, (c) touch Tier 1 funds, (d) take ownership of identity NFTs. Per-builder maximum loss = `perTxCap × active agents` until builder revokes.
- **Tier 3 is ArkAge-controlled and isolated.** Validator compromise = false attestations on completed jobs (bounded by ReputationHook semantics — only future feedback affected). Treasury compromise = ArkAge revenue at risk, not user funds. Each Tier 3 wallet rotates independently.
- **Policy is enforced twice.** Off-chain rejection is fast UX; on-chain rejection is the trust boundary. Compromising one without the other yields no exploitable surface.
- **Revocation is single-tx, instant.** Builder always retains kill-switch.
- **All policy state has a verifiable on-chain hash.** Anyone reading on-chain `AgentInfo.currentPolicyHash` can request the off-chain JSON from ArkAge and verify.

This v1 custody trade is documented prominently at bootstrap and on the public dashboard's "Security" page. v1.5 ERC-7710 migration eliminates the Tier 2 custody requirement entirely.

---

## 6. Dashboard / Explorer

### 6.1 Audience & view map

| Persona | Entry view | Auth required? |
|---------|-----------|----------------|
| Builder | `/console` | Yes (Tier 1 passkey) |
| Counterparty agent operator | `/agents/:id` | No |
| Arc community / spectator | `/` (home) | No |
| Researcher / analyst | `/explorer` | No |

**Public-by-default** for all read-only routes. Wallet auth gates only `/console/*` mutations.

### 6.2 Information architecture

```
/                              Home — protocol pulse
/jobs                          All jobs (filter by state, value, age)
/jobs/:id                      Job detail — full lifecycle, evaluator notes, evidence verify
/agents                        All agents (sortable by reputation, volume, recency)
/agents/:id                    Agent profile — identity, reputation, jobs, x402 endpoints
/x402                          x402 traffic explorer — facilitator stats
/x402/sellers                  Top earners
/x402/sessions/:id             Session detail — receipts
/wallets/:address              Wallet view — Tier-aware tx history with policy context
/reputation                    8004 reputation explorer — distributions, leaderboards
/security                      Public security disclosures + custody model explainer
/console                       Builder dashboard (auth-gated)
/console/agents/:id            Agent management — policy editor, ops, revoke
/console/policies              Policy library + version history
/admin                         ArkAge-internal (team auth)
/admin/evaluator-queue         Pending/recent evaluations
/admin/disputes                x402 disputes
/admin/system-health           Indexer lag, workflow run stats, treasury position
```

### 6.3 Top-priority views (the differentiation showcase)

**(a) Job detail (`/jobs/:id`)** — the showcase view.

Above the fold:
- Header: id · state badge · client/provider/evaluator agents (linked) · budget · expiry countdown
- Lifecycle timeline strip — visual progression `Created → Funded → Submitted → Completed`, timestamps, tx links
- Quick-action zone (only if viewer is the buyer): "Force advance," "Cancel" (where state-legal)

Mid-page:
- **Evaluator panel** — when complete: model used, tier, fee paid, full Claude reasoning, **"Verify evidence" button** (calls `verify_evidence` MCP tool, recomputes hash, confirms on-chain match)
- **Live workflow stream** — embedded SSE viewer pulling from `evaluator:reasoning` namespace via `getReadable`
- **On-chain events** — denormalized human-readable lines, not raw logs

Bottom:
- PolicyHook decisions (any rejected attempts, policy snapshot at funding time)
- Cross-link to `testnet.arcscan.app` for raw view

**(b) Agent profile (`/agents/:id`)** — reputation showcase.

Identity card · numeric score · percentile rank · distribution histogram · score time-series · job history table (as buyer / as provider) · x402 endpoints (if seller, with price + call volume + success rate) · "Hire this agent" / "Pay per call" CTAs (deeplinks to MCP tool invocations).

**(c) Home (`/`)** — protocol pulse.

Top-line cards (active jobs · 24h volume · agents registered · evaluations completed · x402 calls) · live event ticker · most-active leaderboards · stuck-jobs counter (transparency about failure modes) · treasury widget.

The other ~10 views follow generic Etherscan/Blockscout conventions — detailed layouts deferred to implementation. Per user direction, **information density should be lighter than Kronoscan**, prioritizing essential information for users new to ERC-8183.

### 6.4 Real-time pattern

Three layered sources:

| Source | Latency | Best for |
|--------|---------|----------|
| Workflow `getReadable` streams | < 1s | Evaluator reasoning, in-flight workflow status |
| Postgres LISTEN/NOTIFY (Neon) | 1–5s | New jobs, state transitions, x402 receipts |
| Periodic poll (10–30s) | best for stats cards | Counters, leaderboards |

Pattern: server component renders initial state, client component subscribes to SSE route backed by LISTEN/NOTIFY, patches DOM. Workflow streams piped through separate SSE route for the embedded live viewer on job detail.

No WebSocket layer in v1 — SSE is simpler, fully Vercel-native, survives connection drops.

### 6.5 Auth & permissioning

- **Public routes:** no auth, no wallet, no rate-limiting beyond Vercel defaults
- **`/console/*`:** sign-in via Tier 1 passkey signature (Circle Modular passkey ceremony — same primitive as bootstrap). Session token in httpOnly cookie. No password, no email.
- **Destructive actions** (revoke, policy update): require fresh Tier 1 signature beyond session validity. Treats dashboard like a wallet UI.
- **`/admin/*`:** separate ArkAge team auth (Clerk or Sign in with Vercel — TBD at implementation)
- All mutations log to `audit_log`

### 6.6 Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router on Vercel |
| UI | Tailwind + shadcn/ui + framer-motion + recharts |
| Auth | Circle Modular passkey ceremony |
| Data | Neon Postgres via Prisma |
| Live | SSE routes backed by LISTEN/NOTIFY + Workflow `getReadable` |
| Caching | Next 16 `use cache` directive with `cacheTag` invalidation on event ingest |
| Monorepo shape | Single Next.js app contains dashboard + MCP server routes + workflow handlers; one deploy unit for v1 |

### 6.7 Design language

Three opinionated departures from generic block explorers:

- **Domain-aware event rendering.** Never raw logs. Every event has a human-readable line.
- **Evidence-first.** Every reputation entry, every evaluator decision has a "verify evidence" affordance.
- **Live.** Job detail pages stream workflow events as they happen.

Color/typography defaults: dark-first, neutral grays, single accent color (TBD in implementation, likely tied to Arc brand). State colors follow standard semantic conventions (blue=open, yellow=pending, orange=action-needed, green=success, red=failure, gray=expired).

### 6.8 v1 cut

In v1: home, jobs (list + detail), agents (list + profile), x402 sellers/sessions, builder console (agents, policies, revoke), reputation explorer, public security page.

Deferred to v1.5: anomaly alerts page, wallet view, advanced filters, custom dashboards.

Deferred to v2: researcher API + premium analytics (x402-priced), embeddable widgets, mobile-native PWA.

---

## 7. Postgres Schema

### 7.1 Schema philosophy

Three architectural choices:

- **Event-sourced + materialized state, both first-class.** Every observed on-chain event is written immutably to per-domain events tables. Parallel "current state" tables are denormalized for fast dashboard queries. State is always rebuildable from events.
- **Append-only history wherever a value can change.** Policies, agent metadata, wallet operator assignments — every change creates a new row. `current_*_id` foreign keys point at the active version.
- **JSONB for variable shape, typed columns for query-critical fields.** Policy bodies, evaluator responses, agent metadata → JSONB. Status enums, foreign keys, amounts, timestamps → typed.

Conventions:
- All tables: `id BIGSERIAL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- Mutable tables: + `updated_at TIMESTAMPTZ` with trigger
- Idempotency: `(chain_id, tx_hash, log_index) UNIQUE` on every events table
- Money: `NUMERIC(38,0)` raw token units. Inline comment on each monetary column documents the decimal context (USDC ERC-20 = 6 decimals; native gas = 18 decimals)
- Addresses: `BYTEA(20)`
- Hashes: `BYTEA(32)`

### 7.2 Domain tables

#### Identity & wallets

```sql
builders (
  id BIGSERIAL PRIMARY KEY,
  primary_wallet BYTEA UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

wallets (
  id BIGSERIAL PRIMARY KEY,
  address BYTEA UNIQUE NOT NULL,
  tier SMALLINT NOT NULL,                 -- 1 / 2 / 3
  custody TEXT NOT NULL,                  -- 'modular' | 'dcw' | 'system'
  account_type TEXT NOT NULL,             -- 'msca' | 'eoa'
  builder_id BIGINT REFERENCES builders(id),  -- NULL for Tier 3
  circle_wallet_id TEXT,                  -- DCW reference
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paused' | 'revoked'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

agents (
  id BIGSERIAL PRIMARY KEY,
  agent_id NUMERIC(78,0) UNIQUE NOT NULL,  -- ERC-8004 token id
  identity_owner_wallet BYTEA NOT NULL,    -- Tier 1
  current_operator_wallet_id BIGINT NOT NULL REFERENCES wallets(id),
  current_metadata_id BIGINT REFERENCES agent_metadata(id),
  current_policy_id BIGINT REFERENCES policies(id),
  agent_wallet_address BYTEA NOT NULL,     -- the on-chain agentWallet hint
  registered_at_block BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

agent_metadata (                          -- append-only
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),
  metadata_uri TEXT NOT NULL,
  metadata_jsonb JSONB,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

#### Policies

```sql
policies (                                -- append-only
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),
  version INT NOT NULL,
  body_jsonb JSONB NOT NULL,              -- §5.2
  canonical_hash BYTEA NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  authored_by_wallet BYTEA NOT NULL,
  authoring_tx BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, version)
)
```

#### Jobs (ERC-8183)

```sql
jobs (                                    -- materialized current state
  id BIGSERIAL PRIMARY KEY,
  job_id NUMERIC(78,0) UNIQUE NOT NULL,
  client_agent_id BIGINT NOT NULL REFERENCES agents(id),
  provider_agent_id BIGINT REFERENCES agents(id),
  evaluator_address BYTEA NOT NULL,
  evaluator_tier TEXT,                    -- 'fast' | 'standard' | 'premium' | NULL (BYO)
  status TEXT NOT NULL,                   -- 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired'
  budget NUMERIC(38,0),                   -- USDC ERC-20, 6 decimals
  evaluator_fee NUMERIC(38,0),            -- USDC ERC-20, 6 decimals
  description_uri TEXT,
  description_hash BYTEA,
  hook_address BYTEA NOT NULL,
  expired_at TIMESTAMPTZ NOT NULL,
  reason_hash BYTEA,                      -- bytes32 from complete/reject; links to job_evaluations
  created_at_block BIGINT,
  completed_at_block BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

job_events (                              -- append-only, source of truth
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id),
  event_kind TEXT NOT NULL,               -- 'created' | 'budget_set' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired'
  actor_address BYTEA NOT NULL,
  payload_jsonb JSONB,
  chain_id INT NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INT NOT NULL,
  block_number BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, tx_hash, log_index)
)

job_evaluations (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id),
  workflow_run_id TEXT NOT NULL,
  model TEXT NOT NULL,                    -- 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7'
  tier TEXT NOT NULL,
  input_tokens INT,
  output_tokens INT,
  cost_usd NUMERIC(10,4),
  prompt_version TEXT NOT NULL,
  prompt_hash BYTEA NOT NULL,
  deliverable_hash BYTEA NOT NULL,
  reasoning_text TEXT NOT NULL,
  structured_response_jsonb JSONB,
  verdict TEXT NOT NULL,                  -- 'accept' | 'reject'
  score INT,                              -- -100..+100
  evidence_uri TEXT NOT NULL,             -- Vercel Blob URL
  evidence_hash BYTEA NOT NULL,           -- bytes32 reason → on-chain
  settlement_tx BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

#### Reputation (ERC-8004)

```sql
reputation_feedback (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),  -- recipient
  submitter_address BYTEA NOT NULL,                -- ReputationHook for ArkAge feedback
  source TEXT NOT NULL,                            -- 'arkage_hook' | 'external'
  score INT,
  decimals SMALLINT,
  tag1 TEXT,
  tag2 TEXT,
  endpoint TEXT,
  feedback_uri TEXT,
  feedback_hash BYTEA,
  job_id BIGINT REFERENCES jobs(id),
  chain_id INT NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, tx_hash, log_index)
)

reputation_validations (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),
  request_hash BYTEA UNIQUE NOT NULL,
  validator_address BYTEA NOT NULL,
  request_uri TEXT,
  response_code SMALLINT,
  response_uri TEXT,
  requested_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)
```

#### x402

```sql
x402_endpoints (
  id BIGSERIAL PRIMARY KEY,
  seller_agent_id BIGINT NOT NULL REFERENCES agents(id),
  url TEXT NOT NULL,
  effective_url TEXT NOT NULL,            -- self URL or arkage proxy URL
  hosting TEXT NOT NULL,                  -- 'self' | 'arkage-proxy'
  price_per_call NUMERIC(38,0) NOT NULL,  -- USDC ERC-20, 6 decimals
  token_address BYTEA NOT NULL,
  schema_jsonb JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

x402_sessions (
  id BIGSERIAL PRIMARY KEY,
  buyer_agent_id BIGINT NOT NULL REFERENCES agents(id),
  seller_agent_id BIGINT NOT NULL REFERENCES agents(id),
  workflow_run_id TEXT NOT NULL,
  status TEXT NOT NULL,                   -- 'open' | 'closing' | 'closed' | 'risk_gated'
  opened_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  total_calls INT NOT NULL DEFAULT 0,
  total_amount NUMERIC(38,0) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

x402_receipts (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES x402_sessions(id),
  endpoint_id BIGINT NOT NULL REFERENCES x402_endpoints(id),
  payment_kind TEXT NOT NULL,             -- 'gateway_batched' (v1) | future facilitator types
  buyer_wallet BYTEA NOT NULL,
  seller_wallet BYTEA NOT NULL,
  amount NUMERIC(38,0) NOT NULL,          -- USDC ERC-20, 6 decimals
  request_hash BYTEA NOT NULL,
  response_hash BYTEA,
  payment_signature BYTEA NOT NULL,
  http_status SMALLINT,
  facilitator_processed_at TIMESTAMPTZ NOT NULL,
  seq INT NOT NULL,                       -- per-session monotonic
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, seq)
)

x402_disputes (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES x402_receipts(id),
  raised_by_wallet BYTEA NOT NULL,
  reason TEXT NOT NULL,
  evidence_jsonb JSONB,
  workflow_run_id TEXT,
  status TEXT NOT NULL,                   -- 'open' | 'resolved_refund' | 'resolved_no_refund' | 'manual_review'
  resolution_tx BYTEA,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)
```

#### Treasury

```sql
treasury_movements (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                     -- 'evaluator_fee' | 'x402_surcharge' | 'insurance_payout' | 'manual_withdraw'
  source_kind TEXT,
  source_id BIGINT,                       -- polymorphic ref
  amount NUMERIC(38,0) NOT NULL,          -- USDC ERC-20, 6 decimals
  token_address BYTEA NOT NULL,
  direction TEXT NOT NULL,                -- 'in' | 'out'
  counterparty BYTEA,
  tx_hash BYTEA,
  block_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

### 7.3 System tables

```sql
workflow_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,                     -- 'job_lifecycle' | 'evaluator' | 'x402_session' | 'dispute'
  kind_id BIGINT NOT NULL,
  status TEXT NOT NULL,                   -- 'running' | 'completed' | 'failed' | 'cancelled'
  started_at TIMESTAMPTZ NOT NULL,
  last_advanced_at TIMESTAMPTZ NOT NULL,  -- key for stuck-job detector
  completed_at TIMESTAMPTZ,
  parent_run_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
)

indexer_cursor (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                   -- 'goldsky' | 'circle_webhook'
  chain_id INT NOT NULL,
  contract_address BYTEA NOT NULL,
  last_block BIGINT NOT NULL,
  last_processed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source, chain_id, contract_address)
)

audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_kind TEXT NOT NULL,               -- 'builder' | 'admin' | 'system'
  actor_id TEXT,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  payload_jsonb JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

### 7.4 Index strategy

| Pattern | Index |
|---------|-------|
| All jobs for agent X (as client / provider) | `jobs(client_agent_id, status, created_at DESC)`, `jobs(provider_agent_id, status, created_at DESC)` |
| Job timeline for job X | `job_events(job_id, block_time)` |
| Reputation history for agent X | `reputation_feedback(agent_id, created_at DESC)` |
| Stuck workflows | `workflow_runs(kind, status, last_advanced_at) WHERE status = 'running'` (partial) |
| Dedup new event | `(chain_id, tx_hash, log_index) UNIQUE` (already in DDL) |
| x402 traffic in last hour by pair | `x402_receipts(buyer_wallet, seller_wallet, facilitator_processed_at DESC)` |
| Open sessions for buyer X | `x402_sessions(buyer_agent_id, status) WHERE status = 'open'` (partial) |
| Time-series scans (events, receipts) | BRIN on `block_time` / `facilitator_processed_at` |

**Partitioning:** Defer in v1. `x402_receipts` is the only candidate; add monthly partitions if it crosses ~10M rows.

### 7.5 Migration strategy

- **Prisma migrations** for every schema change. No manual SQL on production.
- **Additive-only.** Removals require dual-write/deprecate/drop over two releases.
- **JSONB extensibility.** New evaluator/policy fields go into JSONB without migration; promote to typed columns when query patterns demand it.
- **Backfills idempotent**, lived at `scripts/backfills/YYYY-MM-DD-*.ts`.
- **Policy schemaVersion** lets us evolve the policy DSL without breaking older policies.

---

## 8. Security, Errors & Ops

### 8.1 Threat model & boundaries

| Boundary | Trusted | Worst-case if breached |
|----------|---------|------------------------|
| Smart contracts on Arc | Audited contract code, ERC-8183/8004 reference impls, USDC | Loss of escrowed funds; reputation corruption per agent |
| ArkAge Tier 2 custody | Circle entity secret, ArkAge MCP server signing path | Per-builder loss bounded by `perTxCap × active agents`; PolicyHook still gates |
| ArkAge Tier 3 system wallets | Validator + Treasury keys, isolated rotation | Validator: false 8004 attestations on completed jobs (forward-only impact). Treasury: ArkAge revenue. Each rotates independently. |
| Off-chain data (Postgres + Blob) | Neon at-rest encryption, Vercel Blob private mode | Read: privacy of evaluator reasoning until on-chain settlement. Write: catastrophic — would allow forged evaluator outputs. RLS + connection-string isolation mandatory. |

Out of scope: nation-state attacks on Vercel/Circle/Neon/Anthropic infrastructure, USDC depeg.

### 8.2 Smart contract security

Pre-deploy checklist for each of the 5 contracts:

- [ ] Foundry: ≥95% line coverage, ≥85% branch coverage
- [ ] Invariant tests for Risk #1 (hook contract never owns 8004 NFT) and policy-hash match
- [ ] Slither + Mythril clean (or all findings documented)
- [ ] Manual review by ≥2 contributors with checklist
- [ ] **External audit before mainnet** (testnet may ship without)
- [ ] Bug bounty live before mainnet
- [ ] All deploys verified on `testnet.arcscan.app`
- [ ] Deployed via deterministic CREATE2

**Upgrade story:** non-upgradeable. Bug fixes = redeploy + AgentRegistry pointing.

### 8.3 Off-chain server security

**MCP server:**
- Every tool call requires valid auth context (Tier 1 passkey signature for builder tools, registered DCW operator signature for agent tools)
- Zod input validation at every entry point
- Per-IP / per-builder rate limiting via Vercel Routing Middleware
- BotID gate on `/console/*`
- All outbound calls (viem RPC, Circle API, Anthropic API) wrapped with timeouts + circuit breakers
- Output sanitization: no internal IDs, no stack traces

**Dashboard:**
- Public routes are read-only Server Components
- `/console/*` mutations through dedicated server actions; destructive ops require fresh Tier 1 signature (not just session validity)
- CSP denies inline scripts
- All mutations log to `audit_log`

**Dependencies:**
- `npm audit` in CI; high/critical block merge
- Renovate for non-major bumps
- Lockfile committed; CI verifies install determinism

### 8.4 Custody & key management

| Key | Storage | Rotation | Access |
|-----|---------|----------|--------|
| Circle entity secret | Vercel Env, encrypted | Quarterly + on-incident | Production runtime only |
| Anthropic API key | Vercel Env | Quarterly + on-incident | Workflow steps only |
| Database connection strings | Vercel Env, per-environment | On-incident | Workflows + dashboard server routes |
| Vercel Blob tokens | Vercel Env | Quarterly | Evaluator workflow only |

**Hard rules:** no secret in repo (CI secret scanning), no secret in Postgres, no secret in client-bundled code, secrets fetched via `vercel env pull` for local dev, `.env.local` gitignored.

### 8.5 Error handling philosophy

| Category | Example | Handling |
|----------|---------|----------|
| User error | Out-of-policy spend, malformed input | Friendly message in tool response, no retry, log `info` |
| System error (recoverable) | Transient RPC fail, Anthropic 5xx, Neon blip | `RetryableError` in workflow with backoff; 502 + `Retry-After` in API |
| System error (fatal) | Invariant violation, unknown contract revert | `FatalError` in workflow; 500 with incident ID; page on-call |

**Workflow patterns:**
- Every external call uses retry-with-jitter, max 5 attempts
- Idempotency keys on every state-mutating step
- `FatalError` reserved for "cannot proceed safely"
- Every workflow has top-level try/catch writing failure to `workflow_runs.error`

**API patterns:**
- Typed Result envelopes; no bare exceptions
- Error envelope: `code`, `message`, `incidentId` — never `stack` or internal IDs

### 8.6 Monitoring & alerting

Stack:
- **Vercel Observability** for HTTP routes, function durations, error rates
- **Vercel Workflow inspect / web dashboard** for workflow runs
- **Sentry** for client + server exception tracking with PII scrubbing
- **Custom metrics dashboard** (recharts on Postgres aggregations) for protocol health
- **Vercel Agent** for AI-driven anomaly detection

Alert thresholds (paged):

| Signal | Threshold | Severity |
|--------|----------|----------|
| Goldsky webhook lag | >2 min behind chain head | P2 |
| Stuck workflows | `last_advanced_at >10 min`, status `running` | P2 |
| Evaluator workflow failures | >5% over 1h | P2 |
| Tier 2 wallet signing rate | >3σ above baseline | P1 (potential entity secret breach) |
| PolicyHook revert rate | >1% over 10 min | P2 (policy DB drift?) |
| Treasury negative movement without authorized source | any | P0 |
| Validator wallet signing without active job | any | P0 |
| Database connection errors | >10/min | P1 |

Non-paged signals → daily digest.

### 8.7 Deployment & rollback

- Trunk-based; preview deploy per PR; production via Vercel Rolling Releases (5% → 25% → 100%)
- Schema migrations as pre-deploy step on canary; failures block promotion
- Smart contract deploys: out-of-band, multi-sig deploy wallet; verified addresses committed; production env updated post-verify
- Rollback: Vercel instant rollback for app code; smart contracts via redeploy + AgentRegistry update; schema forward-only with corrective migrations
- Feature flags via Vercel Edge Config; new tools/workflows/contracts default off
- Pre-prod environment = preview-on-testnet (no separate "staging" tier)

### 8.8 Backup & DR

| Scenario | RPO | RTO | Recovery |
|----------|-----|-----|----------|
| Neon outage | 5 min | 30 min | Failover to read replica |
| Vercel region outage | 0 (multi-region) | <5 min | Auto-failover |
| Anthropic outage | n/a | hours | Evaluator workflows pause, resume on recovery |
| Circle API outage | n/a | hours | Tier 2/3 signing paused; chain reads continue; degraded banner |
| Arc Testnet outage | n/a | hours | Stale reads only |
| Entity secret confirmed leak | n/a | 4 hours | Pause Tier 2/3, rotate, re-authorize via Tier 1 |
| Smart contract critical bug | n/a | 24 hours | Bounty disclosure → fix → redeploy → migrate |

Runbooks (live in `docs/runbooks/`, fleshed out during implementation):
- `entity-secret-rotation.md`
- `stuck-job-manual-recovery.md`
- `evaluator-cost-budget-breach.md`
- `policy-hash-drift-investigation.md`
- `tier3-validator-key-compromise.md`
- `mainnet-launch-checklist.md`

---

## 9. Decomposition into Implementation Plans

The full v1 protocol is too large for a single implementation plan. Decompose into **4 parallel-where-possible plans**, each ~2 weeks of work:

### Plan A — Contracts + Indexer + Schema

**Scope:**
- Deploy 5 contracts (HookComposer, ReputationHook, PolicyHook, EvaluatorFeeHook, AgentRegistry) on Arc Testnet
- Foundry test suites
- Goldsky Mirror integration for canonical contracts
- Circle Contract Platform webhook integration for our contracts
- Full Postgres schema via Prisma
- Indexer reconciliation cron

**Dependencies:** None (foundational). Should ship first.

**Done when:** Events flow into Postgres for both canonical and our contracts, schema migrations are clean, contracts pass invariant tests.

### Plan B — MCP Server + Workflows + Evaluator

**Scope:**
- MCP server with all ~26 tools
- 4 workflows (`jobLifecycle`, `llmEvaluatorAgent`, `x402PaymentSession`, `x402DisputeFlow`)
- Wallet routing resolver
- Off-chain policy enforcement
- Stuck-job reconciler cron

**Dependencies:** Plan A (needs schema + contract addresses).

**Done when:** Agent can `bootstrap_user`, `post_job`, `submit_work`, evaluator runs and settles, full lifecycle works end-to-end on testnet.

### Plan C — Dashboard + Auth

**Scope:**
- Public dashboard (home, jobs, agents, x402, reputation, security pages)
- Builder console (auth, agent management, policy editor, revoke)
- Real-time pattern (SSE backed by LISTEN/NOTIFY)
- Live workflow stream embedded on job detail
- Public security page documenting custody model

**Dependencies:** Plan A (data); Plan B for end-to-end testing.

**Done when:** Anonymous user can browse the protocol; builder can sign in via passkey, view agents, edit policy, revoke.

### Plan D — x402 Facilitator Overlay + Sessions

**Scope:**
- `pay_and_call` MCP tool (wraps `GatewayClient.pay()`)
- `register_x402_endpoint` MCP tool with both `self` and `arkage-proxy` hosting modes
- Vercel Function proxy implementation for `arkage-proxy` mode
- `x402PaymentSession` workflow logic for session lifecycle, reputation gates, dispute detection
- `x402DisputeFlow` workflow
- Treasury reconciliation cron

**Dependencies:** Plan A (schema), Plan B (MCP framework).

**Done when:** Two agents can transact via x402; sessions tracked; one dispute flows end-to-end.

### Suggested order

```
Plan A ─────────────────────► Plan B ─────────────────► (testnet beta)
                                  │
                                  ├──► Plan C ────────► (public dashboard)
                                  │
                                  └──► Plan D ────────► (x402 economy)
```

A is foundational. B unlocks the agent-side flows. C and D can run in parallel once B is sufficiently along (probably after the MCP server skeleton is up).

---

## 10. v1.5 / v2 Backlog

Logged from brainstorming so we don't lose them:

| Priority | Item | Rationale |
|----------|------|-----------|
| v1.5 | **ERC-7710 session keys** to replace Tier 2 DCW custody | Eliminates the v1 custody trade entirely; non-custodial throughout |
| v1.5 | **Provider stuck-job insurance pool** | Strong differentiator vs raw 8183; eats stranded-provider risk from §4 |
| v1.5 | **Wallet view + anomaly alerts page** | Dashboard depth |
| v1.5 | **Long-running WebSocket indexer** | If we outgrow Goldsky's latency / pricing |
| v2 | **Safe-as-Tier-1** for teams/DAOs operating shared agents | Multisig governance for builder side |
| v2 | **ZeroDev Kernel** as alternative AA stack | Production session keys today; full migration path |
| v2 | **Premium analytics + researcher API** (x402-priced) | ArkAge revenue diversification |
| v2 | **Embeddable dashboard widgets** for Arc community sites | Distribution play |
| v2 | **Mobile-native PWA** | Reach |
| v2 | **ZK enhancements** (private policies, anonymous reputation, evaluator integrity) | Bleeding-edge differentiation when ZK-LLM matures |
| v2 | **Formal contract verification** (Certora / Halmos) | Pre-significant-TVL |
| When mainnet | **Arc Mainnet migration plan** | Awaits Arc's mainnet launch |

---

## 11. Pre-Implementation Verification Checklist

Three items to verify at the start of implementation, not now:

- [ ] **ERC-8183 + ERC-8004 deployed addresses on Arc Testnet** — confirm against current Arc tutorial docs and on-chain bytecode. The four addresses pinned in §1.3 came from tutorials; they may have been redeployed.
- [ ] **Circle x402 facilitator endpoint URL on Arc Testnet** — verify against current `@circle-fin/x402-batching` SDK version. Domain ID 26 confirmed.
- [ ] **Goldsky Mirror pricing for Arc Testnet event volume** — get a quote based on initial estimates; if disappointing, fall back to Envio HyperIndex (also Arc-supported).

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **ArkAge MCP** | Our MCP server. Distinct from **Arc MCP Server** (Arc's official MCP for AI-assisted development). |
| **Arc MCP Server** | Arc's official tool for AI assistants like Cursor/Claude to write Arc code. Not related to ArkAge's MCP. |
| **Tier 1 wallet** | Builder's Circle Modular Wallet (passkey, MSCA), non-custodial, owns 8004 NFTs |
| **Tier 2 wallet** | Agent's Circle DCW in EOA mode, custodial within policy, signs autonomous actions |
| **Tier 3 wallet** | ArkAge-owned system DCW (validator / treasury / gas-funder) |
| **Chain ID** | EVM chain identifier — Arc Testnet = `5042002` |
| **Domain ID** | Circle Gateway internal identifier — Arc Testnet = `26`. Distinct from chain ID. |
| **USDC native** | Arc's native gas token representation, 18 decimals. Used only for gas accounting. |
| **USDC ERC-20** | Standard USDC at `0x3600…0000`, 6 decimals. All app-level amounts. |
| **HookComposer** | Our router contract that chains PolicyHook + EvaluatorFeeHook + ReputationHook |
| **Reason field threading** | The `bytes32` cryptographic link between off-chain evaluator output and on-chain settlement + reputation |
| **Self-rescue race** | The `Promise.race([hook, sleep, expiry])` pattern wrapping every chain-event await in workflows |
| **BYO evaluator** | Client uses their own evaluator address instead of ArkAge's, skipping our fee |
| **Facilitator overlay** | ArkAge's agent-aware wrapper around Circle's hosted x402 facilitator. We don't run our own facilitator infrastructure. |

---

**End of v1 design specification.**
