# CLAUDE.md

Repo memory for Claude Code (and humans) working on **ArkAge** — the agentic-commerce protocol on Arc Testnet.

> **Read order for new contributors**
> 1. This file — orientation
> 2. `docs/superpowers/specs/2026-05-02-arkage-design.md` — the v1 architecture (canonical)
> 3. `docs/superpowers/plans/2026-05-02-plan-{a,b,c,d}-*.md` — tasked implementation, in order
> 4. Per-area runbooks under `docs/runbooks/` — once contracts are deployed

> **Current state (2026-05-02):** repo contains the design spec, 4 implementation plans, and this file. The directory structure below is what Plan A produces — none of `src/`, `contracts/`, or `prisma/` exists yet. Start by executing Plan A.

> **Heads-up before you start:** Two things in this repo will trip you up if you don't expect them:
> 1. **The Vercel Plugin's post-tool-use validator generates many false positives** for `setTimeout`/`setInterval`/`require`/`fetch` strings, treating them as workflow-sandbox violations even when they're inside React client components, Vercel Function route handlers, Foundry/Solidity code, Node.js config files, or Playwright tests. See "Validator hook noise" below — judge fast, ignore when off-base.
> 2. The repo is **docs-only today**; everything else gets built by executing Plan A.

---

## What ArkAge is

**One sentence:** the first end-to-end commerce protocol for AI agents on Arc — agents hire each other, pay each other (per-job or per-call), build verifiable reputations, all autonomously, in USDC.

**Three pieces (one Next.js deploy):**
1. **MCP server** — 27 tools across 6 domains (identity, jobs, x402, reputation, treasury, admin) that AI agents call over MCP
2. **Workflow runtime** — 4 durable Vercel Workflows (`jobLifecycle`, `llmEvaluatorAgent`, `x402PaymentSession`, `x402DisputeFlow`) that orchestrate end-to-end agent commerce
3. **Dashboard** — public-by-default Next.js UI rendering the live agent economy + builder console (passkey-gated) + admin views

**On-chain footprint (Arc Testnet, chain id `5042002`):** 5 immutable contracts — `HookComposer`, `PolicyHook`, `EvaluatorFeeHook`, `ReputationHook`, `AgentRegistry` — wired into the canonical ERC-8183 AgenticCommerce + ERC-8004 Identity/Reputation registries. Settlement happens in **USDC ERC-20** (6 decimals) at `0x3600…0000`.

---

## The non-negotiable conventions

These are load-bearing. Don't change them without re-reading the spec.

### Money
- **All app-level monetary values use USDC ERC-20 = 6 decimals.** Stored in Postgres as `NUMERIC(38,0)` raw units.
- The Arc native gas-token representation is 18 decimals — only relevant for gas accounting, never user-facing.
- Every monetary Prisma column carries an inline comment documenting the decimal context.

### Wallet tiers (spec §5)
- **Tier 1** — Builder's Circle Modular Wallet (passkey, MSCA). Owns ERC-8004 NFTs. Non-custodial. Used for identity ops, high-value tx, policy issuance, recovery.
- **Tier 2** — Agent's Circle DCW in **EOA mode**. Custodial within policy. **MUST be EOA** because Circle Gateway nanopayments verify via `ecrecover` and don't support EIP-1271 contract signatures (LBC-1 from spec research).
- **Tier 3** — ArkAge system wallets (validator, treasury, gas-funder). Internal.

Routing rules live in `src/lib/wallet-router.ts` and are mirrored on-chain by `PolicyHook`. **Both must approve** any action.

### Hook contract invariant (Risk #1)
The 5 hook/registry contracts MUST never own or be approved-operator of any ERC-8004 identity NFT. This is what keeps `ReputationHook.giveFeedback` ERC-8004-compliant. Foundry invariant test enforces it.

### Self-rescue race (Risk #2)
Every workflow await on a chain event uses `Promise.race([hook, sleep, expiry])` via `awaitChainEventWithRescue` in `src/workflows/lib/self-rescue.ts`. **Three independent ways** to advance: indexer push, workflow self-poll, expiry escape hatch. Don't add a chain-event await without it.

### Reason field threading
The `bytes32 reason` parameter on ERC-8183 `complete`/`reject` is `keccak256(canonicalize(evaluatorOutput))`. The canonical JSON lives in Vercel Blob; the same hash flows into ERC-8004 `feedbackHash` via `ReputationHook`. One cryptographic thread links off-chain evaluation → on-chain settlement → on-chain reputation. Anyone can verify-by-hash via the public `arkage:verify_evidence` MCP tool.

### Idempotency
Every MCP tool that mutates state takes an `idempotencyKey`. Every workflow step that mutates external state attaches a deterministic key (e.g., `complete:${jobId}:v1`). Hook tokens are deterministic strings (e.g., `8183:JobSubmitted:${jobId}`) so push and rescue paths resolve to the same hook (no-op on duplicate fire).

### AI Gateway model IDs
Model slugs use **dots, not hyphens**, for version numbers — `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`, `anthropic/claude-opus-4.7` (NOT `claude-sonnet-4-6`). The Vercel Plugin's validator hook enforces this; wrong format errors out as "Model slug uses hyphens." Verify the current list before locking IDs at implementation time:

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id] | reverse | .[]'
```

### x402 facilitator overlay (LBC-2)
ArkAge does **not** run its own x402 facilitator. We wrap **Circle's hosted facilitator** with three differentiators: agentId-keyed receipt tracking, ERC-8004 reputation gates inside `x402PaymentSession`, and the dispute resolution workflow. Keep this in mind when reading Plan D — most x402 code is "wrap the SDK", not infrastructure.

### Indexing (LBC-3)
We do **not** build a custom indexer. Canonical contracts (USDC, 8183, 8004) → **Goldsky Mirror** → Postgres. ArkAge contracts → **Circle Contract Platform webhooks** → `/api/webhooks/circle` → Postgres. Workflow self-rescue is the correctness layer; indexers are the fast path.

---

## Tech stack at a glance

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router on Vercel, Node.js 24 LTS |
| Language | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| DB | Neon Postgres + Prisma 6 |
| Workflow | Vercel Workflow DevKit (`workflow` + `@workflow/ai` + `@workflow/next`) |
| Smart contracts | Solidity 0.8.28 + Foundry, deterministic CREATE2 |
| Wallets | Circle Modular (passkey, Tier 1) + Circle DCW EOA-mode (Tier 2 + Tier 3) |
| x402 | `@circle-fin/x402-batching` (`GatewayClient`, `createGatewayMiddleware`) |
| Chain RPC | viem against `https://rpc.testnet.arc.network` |
| Indexer | Goldsky Mirror (canonical contracts) + Circle Contract Platform webhooks (ours) |
| LLM evaluator | Anthropic Claude via Vercel AI Gateway — `anthropic/claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-opus-4.7` (use dotted version slugs; verify current IDs at impl time) |
| Auth | Circle Modular passkey ceremony (SimpleWebAuthn) + iron-session httpOnly cookie |
| UI | Tailwind + shadcn/ui + framer-motion + recharts + Sonner |
| Real-time | Postgres LISTEN/NOTIFY + SSE routes + workflow `getReadable` streams |
| Tests | Vitest (unit + integration) · `@workflow/vitest` (workflows) · Playwright (e2e) · Foundry (contracts) |

---

## Project structure

```
ArkAge/
├── src/
│   ├── app/                  # Next.js App Router pages + API routes
│   │   ├── (public)/         # public dashboard routes
│   │   ├── console/          # auth-gated builder console
│   │   ├── admin/            # ArkAge-internal views
│   │   └── api/
│   │       ├── mcp/          # MCP server entry point
│   │       ├── workflows/    # Vercel Workflow DevKit handler mount
│   │       ├── webhooks/     # Circle Contract Platform + x402 facilitator
│   │       ├── stream/       # SSE routes
│   │       ├── cron/         # Vercel Cron handlers
│   │       ├── auth/         # passkey + session
│   │       └── actions/      # console mutation server actions
│   ├── mcp/
│   │   ├── server.ts         # tool registry + MCP server factory
│   │   ├── result.ts         # Result envelope types
│   │   ├── auth.ts           # McpAuthContext type
│   │   ├── dispatch.ts       # request → auth context resolver
│   │   ├── register-all-tools.ts
│   │   └── tools/<domain>/   # one file per MCP tool
│   ├── workflows/
│   │   ├── job-lifecycle.ts
│   │   ├── llm-evaluator-agent.ts
│   │   ├── x402-payment-session.ts
│   │   ├── x402-dispute-flow.ts
│   │   └── lib/              # cross-workflow helpers (self-rescue, hook tokens, settlement steps, prompts)
│   ├── lib/                  # shared modules (db, chain, env, addresses, abis, …)
│   ├── workers/              # cron + webhook handlers (not workflows)
│   ├── components/           # React components
│   │   ├── ui/               # shadcn primitives
│   │   ├── chrome/           # header/footer
│   │   ├── primitives/       # Address, JobStatusBadge, MoneyDisplay, …
│   │   ├── home/, jobs/, agents/, x402/, reputation/, console/, admin/, auth/
│   ├── hooks/                # client React hooks (useSse)
│   └── styles/               # theme tokens
├── prisma/
│   ├── schema.prisma         # full §7 schema
│   ├── migrations/
│   └── seed.ts
├── contracts/                # Foundry project
│   ├── src/
│   │   ├── interfaces/       # IACP, IACPHook, IIdentityRegistry, IReputationRegistry, IAgentRegistry
│   │   ├── HookComposer.sol, PolicyHook.sol, ReputationHook.sol, EvaluatorFeeHook.sol, AgentRegistry.sol
│   ├── test/                 # unit/, integration/, invariant/, mocks/
│   ├── script/Deploy.s.sol
│   └── deployments/arc-testnet.json
├── indexer/
│   └── goldsky/              # Mirror pipeline definition + setup notes
├── tests/
│   ├── unit/, integration/, workflow/, e2e/
├── docs/
│   ├── superpowers/
│   │   ├── specs/2026-05-02-arkage-design.md
│   │   └── plans/2026-05-02-plan-{a,b,c,d}-*.md
│   └── runbooks/             # ops procedures (deploy, secret rotation, x402 onboarding, …)
└── CLAUDE.md                 # this file
```

---

## Development commands

```bash
# Bootstrap (after cloning)
npm install
cp .env.example .env.local              # then fill in values; pull from Vercel for prod
npx prisma migrate dev                  # apply schema + LISTEN/NOTIFY triggers

# Run
npm run dev                             # Next.js dev server on :3000

# Tests
npm test                                # vitest (unit + integration)
npm run test:workflow                   # @workflow/vitest workflow tests
npm run test:e2e                        # Playwright e2e
cd contracts && forge test              # Foundry contract tests

# Smart contracts
cd contracts && forge build
cd contracts && forge coverage --report summary
cd contracts && forge script script/Deploy.s.sol --rpc-url arc_testnet --private-key "$PRIVATE_KEY" --broadcast --verify --verifier blockscout --verifier-url https://testnet.arcscan.app/api

# Workflow inspection
npx workflow web                        # local dashboard
npx workflow inspect runs --backend vercel --project arkage
npx workflow cancel <runId>

# Deploy
vercel --prod                           # production deploy
vercel env pull .env.local              # sync env from Vercel
```

---

## Pinned addresses (Arc Testnet)

**Canonical (primary source: `docs.arc.network/arc/references/contract-addresses`)**
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals)
- Circle GatewayWallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Circle GatewayMinter: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`
- CCTP V2 TokenMessenger: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- CCTP V2 MessageTransmitter: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`
- CREATE2 Factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`

**Tutorial-sourced ⚠️ verify before any deploy or runtime use** — these came from Arc tutorial pages and may have been redeployed. Run the Pre-implementation verification checklist below before pinning them in code:
- ERC-8183 AgenticCommerce: `0x0747EEf0706327138c69792bF28Cd525089e4583`
- ERC-8004 IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- ERC-8004 ValidationRegistry: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`

**ArkAge contracts (post-deploy: Plan A Task 26)**
- Live addresses pinned in `contracts/deployments/arc-testnet.json`
- Available at runtime via `src/lib/addresses.ts` (`ARKAGE_ADDRESSES`)
- Mirrored as env vars: `ARKAGE_HOOK_COMPOSER_ADDRESS`, `ARKAGE_REPUTATION_HOOK_ADDRESS`, `ARKAGE_POLICY_HOOK_ADDRESS`, `ARKAGE_EVALUATOR_FEE_HOOK_ADDRESS`, `ARKAGE_AGENT_REGISTRY_ADDRESS`

**Network**
- Chain ID: `5042002` (decimal) / `0x4CEF52` (hex)
- Circle Gateway domain ID: `26` (distinct from chain ID — both appear in code)
- HTTP RPC: `https://rpc.testnet.arc.network`
- WebSocket RPC: `wss://rpc.testnet.arc.network`
- Faucet: `https://faucet.circle.com`
- Explorer: `https://testnet.arcscan.app`

---

## Plan execution

The four plans are designed to ship in order. Inside each plan, tasks are bite-sized (~2-5 minutes per step) with TDD discipline and a commit per task.

| Plan | Goal | Lines | Status |
|------|------|-------|--------|
| **A** — Contracts + Indexer + Schema | Foundational data layer | ~4,275 | Plan written, ready to execute |
| **B** — MCP + Workflows + Evaluator | Agent-side automation | ~4,874 | Plan written, ready (depends on A) |
| **C** — Dashboard + Auth | UI + builder console + admin | ~5,109 | Plan written, ready (depends on A, B) |
| **D** — x402 Facilitator Overlay | Buyer/seller/proxy/dispute | ~1,957 | Plan written, ready (depends on A, B, C) |

**Recommended execution path:** A → B → (C in parallel with D, both depending on A+B). Each plan ends with a verification checklist and a `git tag plan-{x}-complete` step.

To execute a plan task-by-task, use the **`superpowers:subagent-driven-development`** skill (preferred) or **`superpowers:executing-plans`** skill (inline). Both consume the `- [ ]` checkbox syntax used throughout the plans.

---

## Pre-implementation verification checklist (do this before Plan A starts)

Three items the spec defers to implementation time:

1. **ERC-8183 + ERC-8004 deployed addresses on Arc Testnet** — confirm against current `docs.arc.network/arc/tutorials/*` pages and via `cast code <address> --rpc-url $ARC_TESTNET_RPC_HTTP` to verify bytecode is non-empty. The four addresses pinned above came from tutorials; they may have been redeployed.
2. **Circle x402 facilitator endpoint URL on Arc Testnet** — verify against the installed `@circle-fin/x402-batching` SDK version. Domain ID 26 is confirmed; the specific facilitator service URL ships with the SDK.
3. **Goldsky Mirror pricing for Arc Testnet event volume** — request a quote based on initial estimates. If unfavorable, fall back to **Envio HyperIndex** (also Arc-supported per spec §0).

Track these as the first 3 tasks in any execution session.

---

## When working in this repo

### Adding a new MCP tool
1. Create file under `src/mcp/tools/<domain>/<name>.ts`
2. Define Zod input schema; export `handle<Name>` returning `Result<T>`
3. Call `registerTool({ name: "arkage:<name>", description, inputSchema, handler })`
4. Add a side-effect import line to `src/mcp/register-all-tools.ts`
5. Write integration test under `tests/integration/mcp-<name>.test.ts`

### Adding a new workflow
1. Create file under `src/workflows/<name>.ts`
2. Use `"use workflow"` for orchestration body, `"use step"` for I/O steps
3. Wrap every chain-event await in `awaitChainEventWithRescue` (`src/workflows/lib/self-rescue.ts`)
4. Add `console.log` at step entry/exit (helps debug stuck-workflow cases)
5. Use deterministic hook tokens from `src/workflows/lib/hook-tokens.ts` — extend with new tokens as needed
6. Add a side-effect import to `src/app/api/workflows/[...slug]/route.ts`
7. Write `@workflow/vitest` integration test under `tests/workflow/<name>.test.ts`

### Adding a new public dashboard view
1. Create page under `src/app/(public)/<route>/page.tsx`
2. Default to Server Components for data; Client Components for interactivity
3. Use primitives from `src/components/primitives/` (Address, JobStatusBadge, MoneyDisplay, Timestamp, TxLink, EventRow, EmptyState)
4. For real-time updates, use `useSse` hook (`src/hooks/use-sse.ts`) consuming an `/api/stream/*` route
5. `export const dynamic = "force-dynamic"` for time-sensitive data
6. No auth required by default — `/console/*` and `/admin/*` are the only auth-gated trees

### Adding a new builder console action
1. Server action route under `src/app/api/actions/<name>/route.ts`
2. Always start with `currentBuilder()` from `src/lib/auth-context.ts` for auth
3. For destructive actions, require fresh Tier 1 signature beyond session validity (returns `pendingActions` shape)
4. Always log to `audit_log`
5. Use `router.refresh()` from the client component on success

### Adding a new contract
**v1 contracts are immutable by design.** Bug fixes = redeploy + migration. Adding a *new* contract:
1. Add to `contracts/src/`
2. Foundry tests: ≥95% line / ≥85% branch coverage
3. If it's a hook, ensure the universal invariant holds (never owns 8004 NFTs); add to `HookOwnership.invariant.t.sol`
4. Add to `contracts/script/Deploy.s.sol` in dependency order
5. Pin address in `contracts/deployments/arc-testnet.json` post-deploy
6. Wire env var into `src/lib/env.ts` + `.env.example` + `src/lib/addresses.ts`

### Validator hook noise
The Vercel Plugin's post-tool-use validator pattern-matches `setTimeout`/`setInterval`/`require`/`fetch` strings and assumes workflow-sandbox context. **It generates false positives for React client components, Vercel Function route handlers, Node.js config files (e.g., `tailwind.config.ts`), Playwright tests, and shell commands.** When validator flags a line, check whether that line is inside a `"use workflow"` directive — if not, it's a false positive. Don't waste cycles "fixing" non-existent problems.

---

## Glossary (high-leverage terms)

| Term | Meaning |
|------|---------|
| **ArkAge MCP** | Our MCP server. Distinct from Arc's official **Arc MCP Server** (which is a developer-tool MCP for AI-assisted Arc app development). |
| **Tier 1 / Tier 2 / Tier 3** | Wallet topology — see "Wallet tiers" above. |
| **Chain ID `5042002`** | EVM chain identifier for Arc Testnet. |
| **Domain ID `26`** | Circle Gateway internal identifier for Arc Testnet (NOT the chain ID). Both appear in code. |
| **USDC native vs USDC ERC-20** | Native = 18 decimals (gas accounting only). ERC-20 = 6 decimals (everything else). |
| **HookComposer** | Our pure-router contract chaining `PolicyHook` (before) → `EvaluatorFeeHook` (after) → `ReputationHook` (after). Plugged into ERC-8183's `hook` slot. |
| **Reason field threading** | The `bytes32` cryptographic link between off-chain evaluator output and on-chain settlement + reputation. Verifiable via `arkage:verify_evidence`. |
| **Self-rescue race** | The `Promise.race([hook, sleep, expiry])` pattern wrapping every workflow chain-event await. |
| **BYO evaluator** | Client passes a non-ArkAge address as ERC-8183's `evaluator` parameter; `EvaluatorFeeHook` returns early (no fee taken). |
| **Facilitator overlay** | ArkAge's agent-aware wrapper around Circle's hosted x402 facilitator. We do not run our own facilitator infrastructure. |
| **`hosting=self` vs `hosting=arkage-proxy`** | Seller hosts the x402 middleware themselves vs ArkAge runs a Vercel Function proxy. Pick at `arkage:register_x402_endpoint`. |
| **Plan A/B/C/D** | The four implementation plans under `docs/superpowers/plans/`. Always reference by letter when discussing scope. |
| **LBC-1 / LBC-2 / LBC-3** | Load-bearing changes from research that shape the spec — Tier 2 must be EOA, no own facilitator, use managed indexer. |

---

## v1.5 / v2 backlog (don't lose these)

- **ERC-7710 session keys** to replace Tier 2 DCW custody — primary v1.5 milestone, eliminates the v1 custody trade entirely
- **Provider stuck-job insurance pool** — eats stranded-provider risk
- **Safe-as-Tier-1** for teams/DAOs operating shared agents
- **ZeroDev Kernel** as alternative AA stack (production session keys today)
- **ZK enhancements** — private policies, anonymous reputation, evaluator integrity proofs
- **Premium analytics + researcher API** (x402-priced) — ArkAge revenue diversification
- **Long-running WebSocket indexer** — when Goldsky latency / pricing constrains
- **Formal contract verification** (Certora / Halmos) — pre-significant TVL
- **Mainnet migration plan** — once Arc opens mainnet
- **`arkage:update_x402_endpoint_price` MCP tool** — small UX gap from v1

---

## Help me help you

When you (a future Claude session) start work in this repo:

- If a task is "implement Plan X Task N", use `superpowers:executing-plans` or `superpowers:subagent-driven-development` and follow the plan verbatim. Don't re-derive design decisions.
- If a task is "add a feature", first check whether the spec already covers it. If yes, follow the spec. If no, invoke `superpowers:brainstorming` to extend the design before coding.
- If a task is "fix a bug", invoke `superpowers:systematic-debugging` first. Don't propose fixes without a root cause.
- If you're about to claim work is complete, invoke `superpowers:verification-before-completion` — run the relevant test suite and confirm output before asserting success.
- The validator hook will fire false positives constantly. Read its output, judge fast, ignore when off-base, fix when on-target.
- Cross-session project state lives at `~/.claude/projects/-home-mbarr-ArkAge/memory/`. `MEMORY.md` is the index; `project_arkage_design.md` has the latest project status. Memory loads automatically at session start — you don't need to fetch it.
- This file is the orientation. The spec is the truth. The plans are the executable. Don't paraphrase — link.

---

**Last updated:** 2026-05-02
**v1 status:** spec complete · 4 plans complete · ready to execute Plan A
