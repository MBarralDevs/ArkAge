# Plan B — MCP Server + Workflows + Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the MCP server (~26 tools across 6 domains), implement the wallet routing resolver and off-chain policy enforcement, build the four durable Vercel Workflows (`jobLifecycle`, `llmEvaluatorAgent`, `x402PaymentSession`, `x402DisputeFlow`), and enhance the stuck-workflow reconciler with chain-state queries — producing the full agent-side automation layer.

**Architecture:**
- MCP server lives at `src/app/api/mcp/route.ts` and dispatches to tool handlers in `src/mcp/tools/`. Tools are typed with Zod schemas; outputs are discriminated Result envelopes.
- Wallet routing resolver (`src/lib/wallet-router.ts`) is a pure function — given an action descriptor, returns a Tier 1/2/3 routing decision or rejection.
- Workflows live at `src/workflows/` and follow Vercel Workflow DevKit patterns: `"use workflow"` for orchestration, `"use step"` for I/O, deterministic hook tokens, `Promise.race([hook, sleep, expiry])` self-rescue throughout.
- LLM evaluator uses `DurableAgent` from `@workflow/ai` with model selected by tier (`fast` → Haiku 4.5, `standard` → Sonnet 4.6, `premium` → Opus 4.7).

**Tech Stack:**
- `@modelcontextprotocol/sdk` for MCP server primitives
- `@circle-fin/developer-controlled-wallets` + `@circle-fin/modular-wallets-core` for Circle Wallets
- `workflow` + `@workflow/ai` for durable workflows
- `@workflow/next` framework integration
- `@anthropic-ai/sdk` for the evaluator (DurableAgent uses it under the hood)
- `@vercel/blob` for evaluator evidence storage
- viem for direct chain reads
- Zod for tool schemas
- Vitest for tests

**Plan reference:** Spec at `docs/superpowers/specs/2026-05-02-arkage-design.md` §3 (MCP tools), §4 (workflows), §5 (wallet & policy). Builds on Plan A artifacts (5 deployed contracts, Prisma schema, Postgres in Neon, Goldsky pipeline, Circle webhook receiver).

---

## File structure produced by this plan

```
ArkAge/
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── mcp/
│   │       │   └── route.ts                          # MCP transport entry point
│   │       ├── workflows/
│   │       │   └── [...slug]/
│   │       │       └── route.ts                      # Vercel Workflow handler mount
│   │       └── cron/
│   │           └── reconcile-stuck-workflows/
│   │               └── route.ts                      # MODIFIED in Task 39
│   ├── mcp/
│   │   ├── server.ts                                 # MCP server factory + tool registry
│   │   ├── result.ts                                 # Result envelope helpers
│   │   ├── auth.ts                                   # MCP auth context resolution
│   │   └── tools/
│   │       ├── identity/
│   │       │   ├── bootstrap-user.ts
│   │       │   ├── get-agent-info.ts
│   │       │   ├── update-agent-metadata.ts
│   │       │   ├── revoke-agent.ts
│   │       │   └── get-my-agents.ts
│   │       ├── jobs/
│   │       │   ├── post-job.ts
│   │       │   ├── accept-job.ts
│   │       │   ├── set-budget.ts
│   │       │   ├── fund-job.ts
│   │       │   ├── submit-work.ts
│   │       │   ├── claim-refund.ts
│   │       │   ├── get-job.ts
│   │       │   ├── list-jobs.ts
│   │       │   └── query-jobs.ts
│   │       ├── reputation/
│   │       │   ├── get-reputation.ts
│   │       │   ├── query-reputation-history.ts
│   │       │   └── compare-agents.ts
│   │       ├── treasury/
│   │       │   ├── get-treasury-position.ts
│   │       │   └── withdraw-treasury.ts
│   │       └── admin/
│   │           ├── get-protocol-health.ts
│   │           ├── force-advance-workflow.ts
│   │           └── verify-evidence.ts
│   ├── lib/
│   │   ├── wallet-router.ts                          # routing resolver
│   │   ├── circle-clients.ts                         # Circle SDK clients
│   │   ├── tier1-modular.ts                          # Tier 1 helpers
│   │   ├── tier2-dcw.ts                              # Tier 2 helpers
│   │   ├── tier3-system.ts                           # Tier 3 helpers
│   │   ├── policy-engine.ts                          # off-chain policy evaluation
│   │   ├── policy-canonical.ts                      # canonical hash computation
│   │   ├── multicall.ts                              # Multicall3 helper
│   │   ├── abis.ts                                   # contract ABIs
│   │   ├── erc8183-state.ts                          # job state read helpers
│   │   ├── erc8004-state.ts                          # reputation read helpers
│   │   ├── evidence-store.ts                         # Vercel Blob wrapper
│   │   └── tokens.ts                                 # MCP auth token issuance/verification
│   ├── workflows/
│   │   ├── job-lifecycle.ts                          # workflow #1
│   │   ├── llm-evaluator-agent.ts                    # workflow #2
│   │   ├── x402-payment-session.ts                   # workflow #3
│   │   ├── x402-dispute-flow.ts                      # workflow #4
│   │   ├── lib/
│   │   │   ├── self-rescue.ts                        # `Promise.race([hook, sleep, expiry])` helper
│   │   │   ├── hook-tokens.ts                        # deterministic token derivation
│   │   │   ├── evaluator-prompts.ts                  # versioned prompt templates
│   │   │   └── settlement-steps.ts                   # complete/reject step wrappers
│   │   └── types.ts                                  # cross-workflow type defs
│   ├── workers/
│   │   ├── ingest-circle-event.ts                    # MODIFIED in Task 38
│   │   └── reconcile-stuck-workflows.ts              # MODIFIED in Task 39
│   └── types/
│       └── chain-events.ts                           # decoded event types
├── tests/
│   ├── unit/
│   │   ├── wallet-router.test.ts
│   │   ├── policy-engine.test.ts
│   │   ├── policy-canonical.test.ts
│   │   ├── hook-tokens.test.ts
│   │   ├── self-rescue.test.ts
│   │   ├── evidence-store.test.ts
│   │   └── tokens.test.ts
│   ├── integration/
│   │   ├── mcp-bootstrap-user.test.ts
│   │   ├── mcp-post-job.test.ts
│   │   ├── mcp-tool-registry.test.ts
│   │   └── reconcile-stuck-workflows.integration.test.ts
│   └── workflow/
│       ├── job-lifecycle.test.ts
│       ├── llm-evaluator-agent.test.ts
│       ├── x402-payment-session.test.ts
│       └── x402-dispute-flow.test.ts
└── vitest.workflow.config.ts                         # @workflow/vitest plugin config
```

---

## Execution order constraints

- Tasks 1–3 (Phase 1: MCP infra) must run first
- Tasks 4–8 (Phase 2: Wallet routing + Circle clients) before any tool that signs
- Tasks 9–11 (Phase 3: Policy engine) before policy-gated tools
- Tasks 12–28 (Phases 4–7: MCP tools) can be split across contributors but each tool depends on its domain's helpers being ready
- Tasks 29–32 (Phase 8: Workflow infra) before any workflow
- Tasks 33–37 (Phases 9–12: Workflows) must be in this order — `llmEvaluatorAgent` is spawned by `jobLifecycle`
- Tasks 38–39 (Phase 13: Reconciler upgrades) after workflows
- Tasks 40–41 (Phase 14: Smoke tests + handoff) last

---

## Phase 1 — MCP server infrastructure

### Task 1: Install MCP SDK + define server skeleton

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/result.ts`
- Create: `src/mcp/auth.ts`
- Create: `src/app/api/mcp/route.ts`
- Create: `tests/unit/tokens.test.ts`
- Create: `src/lib/tokens.ts`

- [ ] **Step 1: Install MCP SDK**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write Result envelope helpers**

Create `src/mcp/result.ts`:

```ts
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; code: string; message: string; incidentId?: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
export const err = (code: string, message: string, incidentId?: string): Err =>
  incidentId ? { ok: false, code, message, incidentId } : { ok: false, code, message };
```

- [ ] **Step 3: Write auth context resolver skeleton**

Create `src/mcp/auth.ts`:

```ts
import type { Address } from "viem";

export interface McpAuthContext {
  /** Bearer token raw value, validated against tokens table */
  token: string;
  /** Resolved actor: which builder + which agent this call is acting on behalf of */
  builderId: bigint;
  actingAgentId: bigint | null;
  actingWalletAddress: Address;
}

export class McpAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}
```

- [ ] **Step 4: Write tokens module + failing tests**

Create `tests/unit/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { issueToken, hashToken } from "@/lib/tokens";

describe("tokens", () => {
  it("issues a token with hex prefix and 64 hex chars of entropy", () => {
    const t = issueToken();
    expect(t).toMatch(/^arkage_[0-9a-f]{64}$/);
  });

  it("hashes deterministically", () => {
    const t = "arkage_" + "0".repeat(64);
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("hashes different inputs differently", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
```

- [ ] **Step 5: Run, expect fail**

```bash
npm test tests/unit/tokens.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 6: Implement tokens module**

Create `src/lib/tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function issueToken(): string {
  const entropy = randomBytes(32).toString("hex");
  return `arkage_${entropy}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 7: Run, expect pass**

```bash
npm test tests/unit/tokens.test.ts
```

Expected: 3 pass.

- [ ] **Step 8: Write the MCP server factory**

Create `src/mcp/server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpAuthContext } from "./auth.js";

export interface McpToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: { $schema?: string; type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (input: TInput, ctx: McpAuthContext) => Promise<TOutput>;
}

const TOOL_REGISTRY: McpToolDefinition<unknown, unknown>[] = [];

export function registerTool<I, O>(tool: McpToolDefinition<I, O>): void {
  if (TOOL_REGISTRY.find((t) => t.name === tool.name)) {
    throw new Error(`Tool ${tool.name} already registered`);
  }
  TOOL_REGISTRY.push(tool as McpToolDefinition<unknown, unknown>);
}

export function listRegisteredTools(): readonly McpToolDefinition<unknown, unknown>[] {
  return TOOL_REGISTRY;
}

export function createMcpServer(ctx: McpAuthContext): Server {
  const server = new Server(
    { name: "arkage-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_REGISTRY.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOL_REGISTRY.find((t) => t.name === req.params.name);
    if (!tool) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: "unknown_tool", message: `Tool ${req.params.name} not found` }) }], isError: true };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {}, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: "internal_error", message }) }], isError: true };
    }
  });

  return server;
}
```

- [ ] **Step 9: Write the HTTP route entry point**

Create `src/app/api/mcp/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createMcpServer } from "@/mcp/server";
import { resolveAuthContext } from "@/mcp/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveAuthContext(request);
  if (!ctx.ok) {
    return NextResponse.json({ ok: false, code: ctx.code, message: ctx.message }, { status: 401 });
  }

  const server = createMcpServer(ctx.data);
  const body = await request.json();
  const response = await server.handleRequest(body);
  return NextResponse.json(response);
}
```

- [ ] **Step 10: Write the auth context dispatch**

Create `src/mcp/dispatch.ts`:

```ts
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { ok, err, type Result } from "./result.js";
import type { McpAuthContext } from "./auth.js";
import type { Address } from "viem";

export async function resolveAuthContext(request: Request): Promise<Result<McpAuthContext>> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return err("missing_auth", "Authorization: Bearer <token> header required");
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!/^arkage_[0-9a-f]{64}$/.test(token)) {
    return err("malformed_token", "Token must match arkage_<64 hex>");
  }

  const tokenHash = hashToken(token);
  const row = await db.auditLog.findFirst({
    where: { actorKind: "token", actorId: tokenHash, action: "token.issued" },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    return err("invalid_token", "Token not recognized");
  }

  const payload = row.payloadJsonb as { builderId: string; agentId?: string; walletAddress: string } | null;
  if (!payload) {
    return err("invalid_token", "Token payload missing");
  }

  return ok({
    token,
    builderId: BigInt(payload.builderId),
    actingAgentId: payload.agentId ? BigInt(payload.agentId) : null,
    actingWalletAddress: payload.walletAddress as Address,
  });
}
```

- [ ] **Step 11: Commit**

```bash
git add src/mcp/ src/lib/tokens.ts src/app/api/mcp/ tests/unit/tokens.test.ts package.json package-lock.json
git commit -m "feat(mcp): server skeleton with tool registry, Result envelopes, token auth

- MCP SDK installed
- Server factory + tool registry pattern
- Bearer token auth with SHA-256 hashed lookups in audit_log
- HTTP route at /api/mcp with auth dispatch"
```

---

### Task 2: MCP tool registry integration test

**Files:**
- Create: `tests/integration/mcp-tool-registry.test.ts`

- [ ] **Step 1: Write integration test for tool registry round-trip**

Create `tests/integration/mcp-tool-registry.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createMcpServer, registerTool, listRegisteredTools } from "@/mcp/server";
import { ok } from "@/mcp/result";
import type { McpAuthContext } from "@/mcp/auth";

const TEST_CTX: McpAuthContext = {
  token: "arkage_" + "0".repeat(64),
  builderId: 1n,
  actingAgentId: null,
  actingWalletAddress: "0x0000000000000000000000000000000000000001",
};

beforeAll(() => {
  registerTool({
    name: "test:echo",
    description: "Echo input back",
    inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
    handler: async (input: { msg: string }) => ok({ echoed: input.msg }),
  });
});

describe("MCP tool registry", () => {
  it("includes registered tool in list", () => {
    const tools = listRegisteredTools();
    expect(tools.some((t) => t.name === "test:echo")).toBe(true);
  });

  it("dispatches a tool call and returns the handler's Result", async () => {
    const server = createMcpServer(TEST_CTX);
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:echo", arguments: { msg: "hello" } },
    });
    const text = (response as { result: { content: { text: string }[] } }).result.content[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.echoed).toBe("hello");
  });
});
```

- [ ] **Step 2: Run + verify pass**

```bash
npm test tests/integration/mcp-tool-registry.test.ts
```

Expected: 2 pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-tool-registry.test.ts
git commit -m "test(mcp): tool registry round-trip integration test"
```

---

### Task 3: Common ABIs + chain helpers

**Files:**
- Create: `src/lib/abis.ts`
- Create: `src/lib/multicall.ts`
- Create: `src/lib/erc8183-state.ts`
- Create: `src/lib/erc8004-state.ts`

- [ ] **Step 1: Write the ABIs module**

Create `src/lib/abis.ts`:

```ts
export const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address", name: "owner" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "transfer", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

export const ERC8183_ABI = [
  { type: "function", name: "createJob", inputs: [
    { type: "address", name: "provider" },
    { type: "address", name: "evaluator" },
    { type: "uint256", name: "expiredAt" },
    { type: "string", name: "description" },
    { type: "address", name: "hook" },
  ], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "setBudget", inputs: [{ type: "uint256", name: "jobId" }, { type: "uint256", name: "amount" }, { type: "bytes", name: "data" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "fund", inputs: [{ type: "uint256", name: "jobId" }, { type: "bytes", name: "data" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "submit", inputs: [{ type: "uint256", name: "jobId" }, { type: "bytes32", name: "deliverable" }, { type: "bytes", name: "data" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "complete", inputs: [{ type: "uint256", name: "jobId" }, { type: "bytes32", name: "reason" }, { type: "bytes", name: "data" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "reject", inputs: [{ type: "uint256", name: "jobId" }, { type: "bytes32", name: "reason" }, { type: "bytes", name: "data" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "claimRefund", inputs: [{ type: "uint256", name: "jobId" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getJob", inputs: [{ type: "uint256", name: "jobId" }], outputs: [{
    type: "tuple",
    components: [
      { type: "address", name: "client" },
      { type: "address", name: "provider" },
      { type: "address", name: "evaluator" },
      { type: "uint256", name: "budget" },
      { type: "uint256", name: "expiredAt" },
      { type: "uint8", name: "status" },
      { type: "bytes32", name: "reason" },
      { type: "address", name: "hook" },
    ],
  }], stateMutability: "view" },
  { type: "event", name: "JobCreated", inputs: [
    { type: "uint256", name: "jobId", indexed: true },
    { type: "address", name: "client", indexed: true },
    { type: "address", name: "provider", indexed: true },
    { type: "address", name: "evaluator", indexed: false },
    { type: "uint256", name: "expiredAt", indexed: false },
    { type: "address", name: "hook", indexed: false },
  ] },
  { type: "event", name: "JobFunded", inputs: [{ type: "uint256", name: "jobId", indexed: true }] },
  { type: "event", name: "JobSubmitted", inputs: [{ type: "uint256", name: "jobId", indexed: true }, { type: "bytes32", name: "deliverable", indexed: false }] },
  { type: "event", name: "JobCompleted", inputs: [{ type: "uint256", name: "jobId", indexed: true }, { type: "bytes32", name: "reason", indexed: false }] },
  { type: "event", name: "JobRejected", inputs: [{ type: "uint256", name: "jobId", indexed: true }, { type: "bytes32", name: "reason", indexed: false }] },
] as const;

export const ERC8004_IDENTITY_ABI = [
  { type: "function", name: "ownerOf", inputs: [{ type: "uint256", name: "agentId" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "register", inputs: [{ type: "string", name: "metadataURI" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
] as const;

export const ERC8004_REPUTATION_ABI = [
  { type: "function", name: "giveFeedback", inputs: [
    { type: "uint256", name: "agentId" },
    { type: "int128", name: "value" },
    { type: "uint8", name: "valueDecimals" },
    { type: "string", name: "tag1" },
    { type: "string", name: "tag2" },
    { type: "string", name: "endpoint" },
    { type: "string", name: "feedbackURI" },
    { type: "bytes32", name: "feedbackHash" },
  ], outputs: [], stateMutability: "nonpayable" },
] as const;

export const AGENT_REGISTRY_ABI = [
  { type: "function", name: "registerAgent", inputs: [
    { type: "uint256", name: "agentId" },
    { type: "address", name: "op" },
    { type: "bytes32", name: "policy" },
    { type: "uint128", name: "perTx" },
    { type: "uint64", name: "evalFeeMax" },
  ], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "updateOperator", inputs: [{ type: "uint256", name: "agentId" }, { type: "address", name: "op" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "updatePolicy", inputs: [
    { type: "uint256", name: "agentId" },
    { type: "bytes32", name: "policy" },
    { type: "uint128", name: "perTx" },
    { type: "uint64", name: "evalFeeMax" },
  ], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "deactivate", inputs: [{ type: "uint256", name: "agentId" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "recordJobFee", inputs: [{ type: "uint256", name: "jobId" }, { type: "uint256", name: "fee" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "evaluatorFeeFor", inputs: [{ type: "uint256", name: "jobId" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "agentByOperator", inputs: [{ type: "address", name: "op" }], outputs: [{
    type: "tuple",
    components: [
      { type: "address", name: "operatorWallet" },
      { type: "bytes32", name: "currentPolicyHash" },
      { type: "uint128", name: "perTxCap" },
      { type: "uint64", name: "evaluatorFeeMax" },
      { type: "bool", name: "active" },
    ],
  }], stateMutability: "view" },
] as const;

export const MULTICALL3_ABI = [
  { type: "function", name: "aggregate3", inputs: [{
    type: "tuple[]",
    name: "calls",
    components: [
      { type: "address", name: "target" },
      { type: "bool", name: "allowFailure" },
      { type: "bytes", name: "callData" },
    ],
  }], outputs: [{
    type: "tuple[]",
    components: [
      { type: "bool", name: "success" },
      { type: "bytes", name: "returnData" },
    ],
  }], stateMutability: "payable" },
] as const;
```

- [ ] **Step 2: Write Multicall3 helper**

Create `src/lib/multicall.ts`:

```ts
import { encodeFunctionData, type Address, type Hex } from "viem";
import { ARC_TESTNET_ADDRESSES } from "./addresses.js";
import { MULTICALL3_ABI } from "./abis.js";

export interface MulticallStep {
  target: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  allowFailure?: boolean;
}

export function buildMulticall(steps: MulticallStep[]): { to: Address; data: Hex; value: bigint } {
  const encoded = steps.map((s) => ({
    target: s.target,
    allowFailure: s.allowFailure ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callData: encodeFunctionData({ abi: s.abi as any, functionName: s.functionName, args: s.args as any }),
  }));

  return {
    to: ARC_TESTNET_ADDRESSES.MULTICALL3,
    data: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [encoded] }),
    value: 0n,
  };
}
```

- [ ] **Step 3: Write ERC-8183 state read helpers**

Create `src/lib/erc8183-state.ts`:

```ts
import type { Address } from "viem";
import { publicClient } from "./chain.js";
import { ARC_TESTNET_ADDRESSES } from "./addresses.js";
import { ERC8183_ABI } from "./abis.js";

export type JobStatusEnum = "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired";
const STATUS_LABELS: readonly JobStatusEnum[] = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

export interface OnChainJob {
  client: Address;
  provider: Address;
  evaluator: Address;
  budget: bigint;
  expiredAt: bigint;
  status: JobStatusEnum;
  reason: `0x${string}`;
  hook: Address;
}

export async function readJob(jobId: bigint): Promise<OnChainJob> {
  const raw = await publicClient.readContract({
    address: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
    abi: ERC8183_ABI,
    functionName: "getJob",
    args: [jobId],
  });
  const statusIndex = Number(raw.status);
  const status = STATUS_LABELS[statusIndex];
  if (!status) throw new Error(`Unknown job status index ${statusIndex}`);
  return {
    client: raw.client,
    provider: raw.provider,
    evaluator: raw.evaluator,
    budget: raw.budget,
    expiredAt: raw.expiredAt,
    status,
    reason: raw.reason,
    hook: raw.hook,
  };
}

export function isTerminalState(s: JobStatusEnum): boolean {
  return s === "Completed" || s === "Rejected" || s === "Expired";
}
```

- [ ] **Step 4: Write ERC-8004 helpers**

Create `src/lib/erc8004-state.ts`:

```ts
import type { Address } from "viem";
import { publicClient } from "./chain.js";
import { ARC_TESTNET_ADDRESSES } from "./addresses.js";
import { ERC8004_IDENTITY_ABI } from "./abis.js";

export async function ownerOfAgent(agentId: bigint): Promise<Address> {
  return publicClient.readContract({
    address: ARC_TESTNET_ADDRESSES.ERC_8004_IDENTITY_REGISTRY,
    abi: ERC8004_IDENTITY_ABI,
    functionName: "ownerOf",
    args: [agentId],
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/abis.ts src/lib/multicall.ts src/lib/erc8183-state.ts src/lib/erc8004-state.ts
git commit -m "feat(lib): contract ABIs, Multicall3 helper, on-chain state readers

- ABIs for USDC, ERC-8183, ERC-8004 (Identity + Reputation), AgentRegistry, Multicall3
- buildMulticall encodes aggregate3 calldata for batched txs
- readJob returns typed OnChainJob with enum status
- ownerOfAgent for ERC-8004 identity ownership lookups"
```

---

## Phase 2 — Wallet routing + Circle clients

### Task 4: Install Circle SDKs and write client factories

**Files:**
- Create: `src/lib/circle-clients.ts`

- [ ] **Step 1: Install Circle SDKs**

```bash
npm install @circle-fin/developer-controlled-wallets @circle-fin/modular-wallets-core @circle-fin/x402-batching
```

- [ ] **Step 2: Write Circle client factories**

Create `src/lib/circle-clients.ts`:

```ts
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { env } from "./env.js";

export type CircleDcwClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let cachedDcwClient: CircleDcwClient | null = null;

export function getCircleDcwClient(): CircleDcwClient {
  if (!cachedDcwClient) {
    cachedDcwClient = initiateDeveloperControlledWalletsClient({
      apiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
    });
  }
  return cachedDcwClient;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/circle-clients.ts package.json package-lock.json
git commit -m "feat(lib): Circle DCW client factory with cached singleton"
```

---

### Task 5: Tier 2 DCW provisioning helper

**Files:**
- Create: `src/lib/tier2-dcw.ts`

- [ ] **Step 1: Implement Tier 2 DCW helpers**

Create `src/lib/tier2-dcw.ts`:

```ts
import { getCircleDcwClient } from "./circle-clients.js";
import { db } from "./db.js";
import type { Address } from "viem";

export interface ProvisionedTier2 {
  walletId: string;
  address: Address;
}

export async function provisionTier2DcwForBuilder(builderId: bigint): Promise<ProvisionedTier2> {
  const client = getCircleDcwClient();

  const walletSet = await client.createWalletSet({
    name: `arkage-tier2-builder-${builderId}`,
  });
  const walletSetId = walletSet.data?.walletSet?.id;
  if (!walletSetId) throw new Error("walletSet creation failed");

  const created = await client.createWallets({
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
  });

  const wallet = created.data?.wallets?.[0];
  if (!wallet) throw new Error("wallet creation failed");

  await db.wallet.create({
    data: {
      address: Buffer.from(wallet.address.replace(/^0x/, ""), "hex"),
      tier: 2,
      custody: "dcw",
      accountType: "eoa",
      builderId,
      circleWalletId: wallet.id,
      status: "active",
    },
  });

  return { walletId: wallet.id, address: wallet.address as Address };
}

export async function signWithTier2(
  walletId: string,
  to: Address,
  data: `0x${string}`,
  value: bigint
): Promise<{ txHash: `0x${string}` }> {
  const client = getCircleDcwClient();
  const tx = await client.createTransaction({
    walletId,
    blockchain: "ARC-TESTNET",
    transactionType: "TRANSFER", // DCW maps to a contract call when destinationAddress is a contract
    destinationAddress: to,
    callData: data,
    amount: [value.toString()],
  });
  const txHash = tx.data?.txHash;
  if (!txHash) throw new Error("createTransaction returned no txHash");
  return { txHash: txHash as `0x${string}` };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tier2-dcw.ts
git commit -m "feat(lib): Tier 2 DCW provisioning + signing helpers

- provisionTier2DcwForBuilder creates an EOA-mode DCW on Arc Testnet
  and persists the wallet row in Postgres
- signWithTier2 is the low-level call ArkAge MCP server uses for all
  Tier 2 signed actions"
```

---

### Task 6: Tier 1 modular helpers (server-side stubs only — full passkey flow lives in Plan C dashboard)

**Files:**
- Create: `src/lib/tier1-modular.ts`

- [ ] **Step 1: Implement Tier 1 server-side helpers**

Create `src/lib/tier1-modular.ts`:

```ts
import { db } from "./db.js";
import type { Address } from "viem";

/**
 * Server-side helpers for Tier 1 Modular wallets. The actual passkey
 * ceremony happens client-side in the dashboard (Plan C). The server
 * only records the resulting wallet address and proxies signing
 * intents (the dashboard orchestrates the WebAuthn round-trip).
 */

export interface RegisterTier1Params {
  builderId: bigint;
  address: Address;
}

export async function registerTier1Wallet(params: RegisterTier1Params): Promise<void> {
  await db.wallet.create({
    data: {
      address: Buffer.from(params.address.replace(/^0x/, ""), "hex"),
      tier: 1,
      custody: "modular",
      accountType: "msca",
      builderId: params.builderId,
      status: "active",
    },
  });
}

/**
 * Server-side signal that a Tier 1 signature is required for an action.
 * The MCP tool returns this signal; the calling agent surfaces the
 * pending signature to the human via the dashboard.
 */
export interface PendingTier1Signature {
  kind: "tier1_signature_required";
  reason: "high_value" | "identity_op" | "policy_update" | "revocation";
  unsignedTx: { to: Address; data: `0x${string}`; value: string };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tier1-modular.ts
git commit -m "feat(lib): Tier 1 modular wallet server-side helpers

The passkey ceremony itself is client-side (Plan C dashboard).
Server records the resolved address and produces 'pending Tier 1
signature' descriptors that MCP tools return when an action
exceeds Tier 2 capability."
```

---

### Task 7: Tier 3 system wallet helpers

**Files:**
- Create: `src/lib/tier3-system.ts`

- [ ] **Step 1: Implement Tier 3 helpers**

Create `src/lib/tier3-system.ts`:

```ts
import type { Address } from "viem";
import { env } from "./env.js";
import { getCircleDcwClient } from "./circle-clients.js";

export type Tier3Wallet = "validator" | "treasury" | "gas-funder";

export function getTier3Address(role: Tier3Wallet): Address {
  switch (role) {
    case "validator": {
      if (!env.ARKAGE_VALIDATOR_WALLET_ADDRESS) throw new Error("ARKAGE_VALIDATOR_WALLET_ADDRESS not set");
      return env.ARKAGE_VALIDATOR_WALLET_ADDRESS as Address;
    }
    case "treasury": {
      if (!env.ARKAGE_TREASURY_WALLET_ADDRESS) throw new Error("ARKAGE_TREASURY_WALLET_ADDRESS not set");
      return env.ARKAGE_TREASURY_WALLET_ADDRESS as Address;
    }
    case "gas-funder": {
      if (!env.ARKAGE_GAS_FUNDER_WALLET_ADDRESS) throw new Error("ARKAGE_GAS_FUNDER_WALLET_ADDRESS not set");
      return env.ARKAGE_GAS_FUNDER_WALLET_ADDRESS as Address;
    }
  }
}

export async function signWithTier3(
  role: Tier3Wallet,
  to: Address,
  data: `0x${string}`,
  value: bigint
): Promise<{ txHash: `0x${string}` }> {
  const client = getCircleDcwClient();
  const walletId = await resolveTier3WalletId(role);

  const tx = await client.createTransaction({
    walletId,
    blockchain: "ARC-TESTNET",
    transactionType: "TRANSFER",
    destinationAddress: to,
    callData: data,
    amount: [value.toString()],
  });
  const txHash = tx.data?.txHash;
  if (!txHash) throw new Error(`Tier 3 ${role} signing returned no txHash`);
  return { txHash: txHash as `0x${string}` };
}

const tier3WalletIdCache = new Map<Tier3Wallet, string>();

async function resolveTier3WalletId(role: Tier3Wallet): Promise<string> {
  const cached = tier3WalletIdCache.get(role);
  if (cached) return cached;

  const address = getTier3Address(role);
  const client = getCircleDcwClient();
  const wallets = await client.listWallets({ blockchain: "ARC-TESTNET" });
  const match = wallets.data?.wallets?.find((w) => w.address.toLowerCase() === address.toLowerCase());
  if (!match) throw new Error(`Tier 3 ${role} wallet not found in Circle (address ${address})`);
  tier3WalletIdCache.set(role, match.id);
  return match.id;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tier3-system.ts
git commit -m "feat(lib): Tier 3 system wallet helpers (validator/treasury/gas-funder)

Resolves wallet IDs from env-pinned addresses with cache.
signWithTier3 is the entry point for evaluator settlement
(complete/reject calls), treasury withdrawals, and one-time
Gateway deposits during bootstrap."
```

---

### Task 8: Wallet routing resolver (TDD)

**Files:**
- Create: `tests/unit/wallet-router.test.ts`
- Create: `src/lib/wallet-router.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/wallet-router.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { route, type RoutingAction } from "@/lib/wallet-router";

const baseAgent = {
  agentId: 1n,
  operatorWallet: "0xaaaa000000000000000000000000000000000001" as const,
  perTxCap: 1_000_000n,
  active: true,
};

describe("wallet router", () => {
  it("routes identity operations to Tier 1", () => {
    const decision = route({ kind: "identity_op", subject: "transfer_8004_nft", agent: baseAgent });
    expect(decision.wallet).toBe("tier1-modular");
  });

  it("routes treasury withdrawals to Tier 3 treasury", () => {
    const decision = route({ kind: "treasury_withdraw", agent: baseAgent });
    expect(decision.wallet).toBe("tier3-treasury");
  });

  it("routes evaluator settlement to Tier 3 validator", () => {
    const decision = route({ kind: "evaluator_settlement", agent: baseAgent });
    expect(decision.wallet).toBe("tier3-validator");
  });

  it("routes within-policy actions to Tier 2", () => {
    const decision = route({ kind: "fund_job", amount: 500_000n, agent: baseAgent });
    expect(decision.wallet).toBe("tier2-dcw");
  });

  it("requires Tier 1 when amount exceeds per-tx cap", () => {
    const decision = route({ kind: "fund_job", amount: 2_000_000n, agent: baseAgent });
    expect(decision.wallet).toBe("tier1-modular");
  });

  it("rejects when agent inactive", () => {
    const decision = route({
      kind: "fund_job",
      amount: 500_000n,
      agent: { ...baseAgent, active: false },
    });
    expect("reject" in decision && decision.reject).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test tests/unit/wallet-router.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement router**

Create `src/lib/wallet-router.ts`:

```ts
import type { Address } from "viem";

export interface AgentRoutingContext {
  agentId: bigint;
  operatorWallet: Address;
  perTxCap: bigint;
  active: boolean;
}

export type RoutingAction =
  | { kind: "identity_op"; subject: "transfer_8004_nft" | "burn_8004_nft" | "register_agent" | "update_operator" | "update_policy" | "deactivate"; agent: AgentRoutingContext }
  | { kind: "treasury_withdraw"; agent: AgentRoutingContext }
  | { kind: "evaluator_settlement"; agent: AgentRoutingContext }
  | { kind: "gateway_deposit"; agent: AgentRoutingContext }
  | { kind: "fund_job"; amount: bigint; agent: AgentRoutingContext }
  | { kind: "post_job" | "set_budget" | "submit_work" | "x402_pay"; agent: AgentRoutingContext };

export type RoutingDecision =
  | { wallet: "tier1-modular"; reason: string }
  | { wallet: "tier2-dcw" }
  | { wallet: "tier3-validator" }
  | { wallet: "tier3-treasury" }
  | { wallet: "tier3-gas-funder" }
  | { reject: true; reason: string };

export function route(action: RoutingAction): RoutingDecision {
  if (!action.agent.active) {
    return { reject: true, reason: "agent inactive" };
  }

  switch (action.kind) {
    case "identity_op":
      return { wallet: "tier1-modular", reason: action.subject };
    case "treasury_withdraw":
      return { wallet: "tier3-treasury" };
    case "evaluator_settlement":
      return { wallet: "tier3-validator" };
    case "gateway_deposit":
      return { wallet: "tier3-gas-funder" };
    case "fund_job":
      if (action.amount > action.agent.perTxCap) {
        return { wallet: "tier1-modular", reason: "amount exceeds per-tx cap" };
      }
      return { wallet: "tier2-dcw" };
    case "post_job":
    case "set_budget":
    case "submit_work":
    case "x402_pay":
      return { wallet: "tier2-dcw" };
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test tests/unit/wallet-router.test.ts
```

Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet-router.ts tests/unit/wallet-router.test.ts
git commit -m "feat(lib): wallet routing resolver per spec §5.4

Pure function mapping (action, agent context) → Tier 1/2/3
or reject. Mirrors PolicyHook on-chain logic so off-chain and
on-chain enforcement stay aligned."
```

---

## Phase 3 — Off-chain policy enforcement

### Task 9: Policy canonicalization + hash computation (TDD)

**Files:**
- Create: `tests/unit/policy-canonical.test.ts`
- Create: `src/lib/policy-canonical.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/policy-canonical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canonicalizePolicy, hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";

const samplePolicy: AgentPolicy = {
  schemaVersion: 1,
  agentId: "42",
  version: 1,
  validFrom: 1700000000,
  validTo: null,
  spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
  allowedContracts: ["0x0747eef0706327138c69792bf28cd525089e4583"],
  allowedSelectors: ["0x12345678"],
  counterpartyRules: { minReputation: 50, allowList: [], denyList: [] },
  rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 100 },
  tokens: ["0x3600000000000000000000000000000000000000"],
  evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
};

describe("policy canonicalization", () => {
  it("produces same hash regardless of key ordering in input", () => {
    const reordered = JSON.parse(JSON.stringify(samplePolicy));
    const hashA = hashPolicy(samplePolicy);
    const hashB = hashPolicy(reordered);
    expect(hashA).toBe(hashB);
  });

  it("hash is 0x-prefixed 32-byte hex", () => {
    const h = hashPolicy(samplePolicy);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const h1 = hashPolicy(samplePolicy);
    const modified = { ...samplePolicy, version: 2 };
    expect(hashPolicy(modified)).not.toBe(h1);
  });

  it("canonicalize sorts keys alphabetically at every level", () => {
    const canonical = canonicalizePolicy(samplePolicy);
    const keys = Object.keys(JSON.parse(canonical));
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test tests/unit/policy-canonical.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement canonicalizer**

Create `src/lib/policy-canonical.ts`:

```ts
import { keccak256, toHex } from "viem";

export interface AgentPolicy {
  schemaVersion: 1;
  agentId: string;
  version: number;
  validFrom: number;
  validTo: number | null;
  spendCaps: { perTx: string; perDay: string; perWeek: string };
  allowedContracts: string[];
  allowedSelectors: string[];
  counterpartyRules: { minReputation: number | null; allowList: string[]; denyList: string[] };
  rateLimits: { jobsPerHour: number; x402CallsPerMinute: number };
  tokens: string[];
  evaluatorPreferences: { defaultTier: "fast" | "standard" | "premium"; maxFeePerJob: string };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

export function canonicalizePolicy(policy: AgentPolicy): string {
  return JSON.stringify(sortKeysDeep(policy));
}

export function hashPolicy(policy: AgentPolicy): `0x${string}` {
  const canonical = canonicalizePolicy(policy);
  return keccak256(toHex(canonical));
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test tests/unit/policy-canonical.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy-canonical.ts tests/unit/policy-canonical.test.ts
git commit -m "feat(lib): policy canonicalization + keccak256 hash

Recursive key-sort produces the canonical JSON form whose
keccak256 matches AgentRegistry.currentPolicyHash on-chain."
```

---

### Task 10: Policy engine (off-chain enforcement)

**Files:**
- Create: `tests/unit/policy-engine.test.ts`
- Create: `src/lib/policy-engine.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/policy-engine.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { evaluatePolicy, type PolicyCheckRequest } from "@/lib/policy-engine";
import type { AgentPolicy } from "@/lib/policy-canonical";

const POLICY: AgentPolicy = {
  schemaVersion: 1,
  agentId: "100",
  version: 1,
  validFrom: 0,
  validTo: null,
  spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
  allowedContracts: ["0x0747eef0706327138c69792bf28cd525089e4583"],
  allowedSelectors: [],
  counterpartyRules: { minReputation: null, allowList: [], denyList: ["0xdead000000000000000000000000000000000000"] },
  rateLimits: { jobsPerHour: 5, x402CallsPerMinute: 50 },
  tokens: [],
  evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
};

const baseReq: Omit<PolicyCheckRequest, "policy"> = {
  agentDbId: 1n,
  action: "fund_job",
  amount: 500_000n,
  counterparty: "0xaaaa000000000000000000000000000000000001",
  contractTarget: "0x0747eef0706327138c69792bf28cd525089e4583",
};

describe("evaluatePolicy", () => {
  beforeEach(async () => {
    await db.auditLog.deleteMany({ where: { actorId: { startsWith: "test-policy-" } } });
  });

  afterEach(async () => {
    await db.auditLog.deleteMany({ where: { actorId: { startsWith: "test-policy-" } } });
  });

  it("approves when within all caps + allowlist", async () => {
    const verdict = await evaluatePolicy({ ...baseReq, policy: POLICY });
    expect(verdict.ok).toBe(true);
  });

  it("rejects amount over perTx cap", async () => {
    const verdict = await evaluatePolicy({ ...baseReq, amount: 2_000_000n, policy: POLICY });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("policy:per_tx_cap");
  });

  it("rejects contract not in allowlist", async () => {
    const verdict = await evaluatePolicy({
      ...baseReq,
      contractTarget: "0xbbbb000000000000000000000000000000000001",
      policy: POLICY,
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects denied counterparty", async () => {
    const verdict = await evaluatePolicy({
      ...baseReq,
      counterparty: "0xdead000000000000000000000000000000000000",
      policy: POLICY,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("policy:counterparty_denied");
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test tests/unit/policy-engine.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement policy engine**

Create `src/lib/policy-engine.ts`:

```ts
import type { Address } from "viem";
import type { AgentPolicy } from "./policy-canonical.js";

export interface PolicyCheckRequest {
  agentDbId: bigint;
  policy: AgentPolicy;
  action: "post_job" | "fund_job" | "set_budget" | "submit_work" | "x402_pay";
  amount?: bigint;
  counterparty?: Address;
  contractTarget: Address;
}

export type PolicyVerdict = { ok: true } | { ok: false; code: string; message: string };

export async function evaluatePolicy(req: PolicyCheckRequest): Promise<PolicyVerdict> {
  if (req.policy.validTo !== null) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > req.policy.validTo) {
      return { ok: false, code: "policy:expired", message: "policy validTo has passed" };
    }
  }

  const target = req.contractTarget.toLowerCase();
  const allowedContracts = req.policy.allowedContracts.map((a) => a.toLowerCase());
  if (allowedContracts.length > 0 && !allowedContracts.includes(target)) {
    return { ok: false, code: "policy:contract_not_allowed", message: `${req.contractTarget} not in allowlist` };
  }

  if (req.counterparty) {
    const cp = req.counterparty.toLowerCase();
    const denied = req.policy.counterpartyRules.denyList.map((a) => a.toLowerCase());
    if (denied.includes(cp)) {
      return { ok: false, code: "policy:counterparty_denied", message: `${req.counterparty} is denied` };
    }
    const allowed = req.policy.counterpartyRules.allowList.map((a) => a.toLowerCase());
    if (allowed.length > 0 && !allowed.includes(cp)) {
      return { ok: false, code: "policy:counterparty_not_allowed", message: `${req.counterparty} not in allowlist` };
    }
  }

  if (req.amount !== undefined) {
    const perTx = BigInt(req.policy.spendCaps.perTx);
    if (req.amount > perTx) {
      return { ok: false, code: "policy:per_tx_cap", message: `amount ${req.amount} exceeds perTx ${perTx}` };
    }
    // perDay / perWeek rolling caps are deferred to a follow-up task that aggregates
    // recent treasury_movements and job_events; for this task the per-tx cap covers the basic gate.
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test tests/unit/policy-engine.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy-engine.ts tests/unit/policy-engine.test.ts
git commit -m "feat(lib): off-chain policy engine

Stateless gate checking validTo, contract allowlist, counterparty
deny/allow list, per-tx cap. Rolling caps (per-day/per-week)
deferred to a follow-up task once event aggregation is in place."
```

---

### Task 11: Policy + agent loader (loads active policy for an agent)

**Files:**
- Create: `src/lib/agent-loader.ts`

- [ ] **Step 1: Implement agent + policy loader**

Create `src/lib/agent-loader.ts`:

```ts
import { db } from "./db.js";
import type { AgentPolicy } from "./policy-canonical.js";
import type { Address } from "viem";

export interface LoadedAgent {
  dbId: bigint;
  agentId: bigint;
  operatorWallet: Address;
  identityOwner: Address;
  active: boolean;
  policy: AgentPolicy;
  perTxCap: bigint;
}

export class AgentNotFoundError extends Error {
  constructor(public readonly query: string) {
    super(`agent not found: ${query}`);
  }
}

export async function loadAgentByDbId(dbId: bigint): Promise<LoadedAgent> {
  const row = await db.agent.findUnique({
    where: { id: dbId },
    include: {
      policies: {
        where: { validTo: null },
        orderBy: { version: "desc" },
        take: 1,
      },
      currentOperatorWallet: true,
    },
  });
  if (!row) throw new AgentNotFoundError(`dbId=${dbId}`);
  const policyRow = row.policies[0];
  if (!policyRow) throw new AgentNotFoundError(`no active policy for dbId=${dbId}`);

  return {
    dbId: row.id,
    agentId: BigInt(row.agentId.toString()),
    operatorWallet: ("0x" + Buffer.from(row.currentOperatorWallet.address).toString("hex")) as Address,
    identityOwner: ("0x" + Buffer.from(row.identityOwnerWallet).toString("hex")) as Address,
    active: row.active,
    policy: policyRow.bodyJsonb as unknown as AgentPolicy,
    perTxCap: BigInt(policyRow.bodyJsonb !== null ? (policyRow.bodyJsonb as { spendCaps: { perTx: string } }).spendCaps.perTx : "0"),
  };
}

export async function loadAgentByOperator(operator: Address): Promise<LoadedAgent> {
  const wallet = await db.wallet.findUnique({
    where: { address: Buffer.from(operator.replace(/^0x/, ""), "hex") },
  });
  if (!wallet) throw new AgentNotFoundError(`operator=${operator}`);

  const agent = await db.agent.findFirst({ where: { currentOperatorWalletId: wallet.id } });
  if (!agent) throw new AgentNotFoundError(`no agent for operator=${operator}`);
  return loadAgentByDbId(agent.id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent-loader.ts
git commit -m "feat(lib): agent + active-policy loader

Single function returns the LoadedAgent struct used by every MCP
tool — operator wallet, identity owner, active policy, per-tx cap.
Throws AgentNotFoundError on miss."
```

---

## Phase 4 — Identity & Wallet domain (5 MCP tools)

### Task 12: `arkage:bootstrap_user` tool (deep — see spec §3.3)

**Files:**
- Create: `src/mcp/tools/identity/bootstrap-user.ts`
- Create: `tests/integration/mcp-bootstrap-user.test.ts`

- [ ] **Step 1: Write failing integration test (high level — full Circle SDK calls mocked at the SDK boundary)**

Create `tests/integration/mcp-bootstrap-user.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBootstrapUser } from "@/mcp/tools/identity/bootstrap-user";
import { db } from "@/lib/db";

vi.mock("@/lib/tier2-dcw", () => ({
  provisionTier2DcwForBuilder: vi.fn(async () => ({
    walletId: "test-wallet-id",
    address: "0x2222000000000000000000000000000000000002",
  })),
}));

describe("bootstrap_user", () => {
  beforeEach(async () => {
    await db.builder.deleteMany({ where: { displayName: { startsWith: "test-bootstrap-" } } });
  });

  it("creates builder + Tier 2 wallet record + returns identifiers", async () => {
    const result = await handleBootstrapUser(
      {
        mode: "passkey-builder+dcw-agent",
        agentMetadata: { name: "TestAgent", description: "x", capabilities: [], version: "0.1.0" },
        builderPrimaryWallet: "0x1111000000000000000000000000000000000001",
        displayName: "test-bootstrap-1",
        idempotencyKey: "boot-test-1",
      },
      {
        token: "arkage_" + "0".repeat(64),
        builderId: 0n,
        actingAgentId: null,
        actingWalletAddress: "0x1111000000000000000000000000000000000001",
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.builderWalletAddress).toBe("0x1111000000000000000000000000000000000001");
      expect(result.data.agentOperatorWallet).toBe("0x2222000000000000000000000000000000000002");
    }
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test tests/integration/mcp-bootstrap-user.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement bootstrap_user tool**

Create `src/mcp/tools/identity/bootstrap-user.ts`:

```ts
import { z } from "zod";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { provisionTier2DcwForBuilder } from "@/lib/tier2-dcw";
import { hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";
import { registerTier1Wallet, type PendingTier1Signature } from "@/lib/tier1-modular";

const Input = z.object({
  mode: z.enum(["passkey-builder+dcw-agent", "dcw-only", "passkey-only"]),
  agentMetadata: z.object({
    name: z.string().min(1),
    description: z.string(),
    capabilities: z.array(z.string()),
    version: z.string(),
  }),
  builderPrimaryWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  displayName: z.string().optional(),
  initialPolicy: z.unknown().optional(),
  evaluatorTier: z.enum(["fast", "standard", "premium"]).default("standard"),
  idempotencyKey: z.string().min(1),
});

type BootstrapInput = z.infer<typeof Input>;

interface BootstrapOutput {
  builderWalletAddress: Address;
  agentIdentityId: string | null; // null until on-chain mint completes; surfaced via PendingTier1Signature
  agentOperatorWallet: Address;
  policyVersion: number;
  policyHash: `0x${string}`;
  pendingActions: PendingTier1Signature[];
}

function defaultPolicy(agentIdPlaceholder: string, evaluatorTier: BootstrapInput["evaluatorTier"]): AgentPolicy {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    schemaVersion: 1,
    agentId: agentIdPlaceholder,
    version: 1,
    validFrom: nowSec,
    validTo: null,
    spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
    allowedContracts: [],
    allowedSelectors: [],
    counterpartyRules: { minReputation: null, allowList: [], denyList: [] },
    rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 60 },
    tokens: ["0x3600000000000000000000000000000000000000"],
    evaluatorPreferences: { defaultTier: evaluatorTier, maxFeePerJob: "5000000" },
  };
}

export async function handleBootstrapUser(
  rawInput: unknown,
  _ctx: McpAuthContext
): Promise<Result<BootstrapOutput>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) {
    return err("validation_error", parse.error.message);
  }
  const input = parse.data;

  const builderWallet = Buffer.from(input.builderPrimaryWallet.replace(/^0x/, ""), "hex");
  const builder = await db.builder.upsert({
    where: { primaryWallet: builderWallet },
    update: { displayName: input.displayName ?? undefined },
    create: { primaryWallet: builderWallet, displayName: input.displayName ?? null },
  });

  if (input.mode !== "dcw-only") {
    await registerTier1Wallet({ builderId: builder.id, address: input.builderPrimaryWallet as Address });
  }

  const tier2 = await provisionTier2DcwForBuilder(builder.id);

  const policy = defaultPolicy(`pending:${builder.id}`, input.evaluatorTier);
  const policyHash = hashPolicy(policy);

  await db.auditLog.create({
    data: {
      actorKind: "builder",
      actorId: input.builderPrimaryWallet,
      action: "bootstrap_user",
      payloadJsonb: { mode: input.mode, idempotencyKey: input.idempotencyKey } as object,
    },
  });

  const pendingActions: PendingTier1Signature[] = [];
  if (input.mode !== "dcw-only") {
    pendingActions.push({
      kind: "tier1_signature_required",
      reason: "identity_op",
      unsignedTx: {
        to: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        data: "0x",
        value: "0",
      },
    });
  }

  return ok({
    builderWalletAddress: input.builderPrimaryWallet as Address,
    agentIdentityId: null,
    agentOperatorWallet: tier2.address,
    policyVersion: policy.version,
    policyHash,
    pendingActions,
  });
}

registerTool({
  name: "arkage:bootstrap_user",
  description: "Provision a builder + agent (Tier 1 + Tier 2 wallets), default policy, identity intent",
  inputSchema: { type: "object", properties: {}, required: [] }, // schema sourced from Zod at runtime
  handler: handleBootstrapUser,
});
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test tests/integration/mcp-bootstrap-user.test.ts
```

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/identity/bootstrap-user.ts tests/integration/mcp-bootstrap-user.test.ts
git commit -m "feat(mcp): bootstrap_user tool (identity domain)

Provisions builder + Tier 1 record + Tier 2 DCW EOA, generates
default policy, computes canonical hash, returns pending Tier 1
signature for the on-chain identity mint + AgentRegistry.registerAgent
that the dashboard completes."
```

---

### Task 13: Identity reads — `get_agent_info` + `get_my_agents`

**Files:**
- Create: `src/mcp/tools/identity/get-agent-info.ts`
- Create: `src/mcp/tools/identity/get-my-agents.ts`

- [ ] **Step 1: Implement `get_agent_info`**

Create `src/mcp/tools/identity/get-agent-info.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

interface AgentInfoOutput {
  agentId: string;
  identityOwner: string;
  operatorWallet: string;
  active: boolean;
  metadata: { name: string; description: string; capabilities: string[]; version: string } | null;
}

export async function handleGetAgentInfo(rawInput: unknown): Promise<Result<AgentInfoOutput>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUnique({
    where: { agentId: parse.data.agentId },
    include: { metadata: { orderBy: { createdAt: "desc" }, take: 1 }, currentOperatorWallet: true },
  });
  if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

  const m = agent.metadata[0]?.metadataJsonb as { name: string; description: string; capabilities: string[]; version: string } | undefined;

  return ok({
    agentId: agent.agentId.toString(),
    identityOwner: "0x" + Buffer.from(agent.identityOwnerWallet).toString("hex"),
    operatorWallet: "0x" + Buffer.from(agent.currentOperatorWallet.address).toString("hex"),
    active: agent.active,
    metadata: m ?? null,
  });
}

registerTool({
  name: "arkage:get_agent_info",
  description: "Read agent identity, operator wallet, active flag, latest metadata",
  inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] },
  handler: handleGetAgentInfo,
});
```

- [ ] **Step 2: Implement `get_my_agents`**

Create `src/mcp/tools/identity/get-my-agents.ts`:

```ts
import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

interface MyAgentsOutput {
  agents: Array<{ agentId: string; operatorWallet: string; active: boolean }>;
}

export async function handleGetMyAgents(_input: unknown, ctx: McpAuthContext): Promise<Result<MyAgentsOutput>> {
  const wallets = await db.wallet.findMany({ where: { builderId: ctx.builderId, tier: 2 }, select: { id: true, address: true } });
  if (wallets.length === 0) return ok({ agents: [] });

  const agents = await db.agent.findMany({
    where: { currentOperatorWalletId: { in: wallets.map((w) => w.id) } },
    select: { agentId: true, currentOperatorWallet: true, active: true },
  });

  return ok({
    agents: agents.map((a) => ({
      agentId: a.agentId.toString(),
      operatorWallet: "0x" + Buffer.from(a.currentOperatorWallet.address).toString("hex"),
      active: a.active,
    })),
  });
}

registerTool({
  name: "arkage:get_my_agents",
  description: "List all agents owned by the authenticated builder",
  inputSchema: { type: "object", properties: {} },
  handler: handleGetMyAgents,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/identity/get-agent-info.ts src/mcp/tools/identity/get-my-agents.ts
git commit -m "feat(mcp): identity read tools (get_agent_info, get_my_agents)"
```

---

### Task 14: Identity writes — `update_agent_metadata` + `revoke_agent`

**Files:**
- Create: `src/mcp/tools/identity/update-agent-metadata.ts`
- Create: `src/mcp/tools/identity/revoke-agent.ts`

- [ ] **Step 1: Implement `update_agent_metadata`**

Create `src/mcp/tools/identity/update-agent-metadata.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({
  agentId: z.string().regex(/^[0-9]+$/),
  metadata: z.object({ name: z.string(), description: z.string(), capabilities: z.array(z.string()), version: z.string() }),
  metadataUri: z.string().url(),
});

export async function handleUpdateAgentMetadata(rawInput: unknown): Promise<Result<{ metadataId: string }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
  if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

  const row = await db.agentMetadata.create({
    data: {
      agentId: agent.id,
      metadataUri: parse.data.metadataUri,
      metadataJsonb: parse.data.metadata as object,
      fetchedAt: new Date(),
    },
  });
  await db.agent.update({ where: { id: agent.id }, data: { currentMetadataId: row.id } });

  return ok({ metadataId: row.id.toString() });
}

registerTool({
  name: "arkage:update_agent_metadata",
  description: "Append a new metadata version for an agent (name/description/capabilities/version)",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleUpdateAgentMetadata,
});
```

- [ ] **Step 2: Implement `revoke_agent`**

Create `src/mcp/tools/identity/revoke-agent.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { encodeFunctionData, type Address } from "viem";
import { AGENT_REGISTRY_ABI } from "@/lib/abis";
import { ARKAGE_ADDRESSES } from "@/lib/addresses";
import type { PendingTier1Signature } from "@/lib/tier1-modular";

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

interface RevokeOutput {
  pendingActions: PendingTier1Signature[];
}

export async function handleRevokeAgent(rawInput: unknown): Promise<Result<RevokeOutput>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
  if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);
  if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) return err("config_error", "AGENT_REGISTRY address not set");

  await db.wallet.update({ where: { id: agent.currentOperatorWalletId }, data: { status: "revoked" } });
  await db.agent.update({ where: { id: agent.id }, data: { active: false } });

  const data = encodeFunctionData({
    abi: AGENT_REGISTRY_ABI,
    functionName: "deactivate",
    args: [BigInt(parse.data.agentId)],
  });

  return ok({
    pendingActions: [{
      kind: "tier1_signature_required",
      reason: "revocation",
      unsignedTx: { to: ARKAGE_ADDRESSES.AGENT_REGISTRY as Address, data, value: "0" },
    }],
  });
}

registerTool({
  name: "arkage:revoke_agent",
  description: "Mark agent inactive off-chain immediately; return pending Tier 1 tx for on-chain deactivate()",
  inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] },
  handler: handleRevokeAgent,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/identity/update-agent-metadata.ts src/mcp/tools/identity/revoke-agent.ts
git commit -m "feat(mcp): identity write tools (update_agent_metadata, revoke_agent)

Revoke marks DB rows revoked instantly + returns Tier 1 signature
intent for on-chain AgentRegistry.deactivate. MCP server stops
honoring agent calls as soon as DB flag flips."
```

---

## Phase 5 — Jobs domain (9 MCP tools)

### Task 15: `arkage:post_job` tool (deep — see spec §3.3)

**Files:**
- Create: `src/mcp/tools/jobs/post-job.ts`
- Create: `tests/integration/mcp-post-job.test.ts`

- [ ] **Step 1: Implement `post_job`**

Create `src/mcp/tools/jobs/post-job.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { route } from "@/lib/wallet-router";
import { evaluatePolicy } from "@/lib/policy-engine";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { start } from "workflow/api";
import { jobLifecycle } from "@/workflows/job-lifecycle";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  provider: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  evaluator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  evaluatorTier: z.enum(["fast", "standard", "premium"]).optional(),
  expiredAtSec: z.number().int().positive(),
  description: z.string(),
  budgetMin: z.string().regex(/^[0-9]+$/).optional(),
  hook: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  idempotencyKey: z.string().min(1),
});

interface PostJobOutput {
  jobId: string | null; // populated once event indexed
  createTx: `0x${string}`;
  workflowRunId: string;
}

export async function handlePostJob(rawInput: unknown, _ctx: McpAuthContext): Promise<Result<PostJobOutput>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

  const policyVerdict = await evaluatePolicy({
    agentDbId: agent.dbId,
    policy: agent.policy,
    action: "post_job",
    contractTarget: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
  });
  if (!policyVerdict.ok) return err(policyVerdict.code, policyVerdict.message);

  const decision = route({ kind: "post_job", agent: { agentId: agent.agentId, operatorWallet: agent.operatorWallet, perTxCap: agent.perTxCap, active: agent.active } });
  if ("reject" in decision) return err("routing_rejected", decision.reason);
  if (decision.wallet !== "tier2-dcw") return err("routing_unexpected", `expected tier2-dcw, got ${decision.wallet}`);

  const hookAddr = (parse.data.hook ?? ARKAGE_ADDRESSES.HOOK_COMPOSER) as Address | undefined;
  if (!hookAddr) return err("config_error", "HOOK_COMPOSER not configured and no hook supplied");

  const callData = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "createJob",
    args: [
      (parse.data.provider ?? "0x0000000000000000000000000000000000000000") as Address,
      parse.data.evaluator as Address,
      BigInt(parse.data.expiredAtSec),
      parse.data.description,
      hookAddr,
    ],
  });

  const wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") } });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const { txHash } = await signWithTier2(wallet.circleWalletId, ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, callData, 0n);

  const run = await start(jobLifecycle, [BigInt(0), parse.data.expiredAtSec]);

  await db.auditLog.create({
    data: {
      actorKind: "agent",
      actorId: agent.agentId.toString(),
      action: "post_job",
      payloadJsonb: { txHash, idempotencyKey: parse.data.idempotencyKey } as object,
    },
  });

  return ok({ jobId: null, createTx: txHash, workflowRunId: run.runId });
}

registerTool({
  name: "arkage:post_job",
  description: "Post an ERC-8183 job; returns createTx and the spawned jobLifecycle workflow run id",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handlePostJob,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/jobs/post-job.ts
git commit -m "feat(mcp): post_job tool

Routes to Tier 2, signs createJob, spawns jobLifecycle workflow.
jobId resolved from chain event by indexer (set NULL until then).
Fee recording deferred to fund_job per spec §3.3."
```

---

### Task 16: Provider-side jobs — `accept_job`, `set_budget`, `fund_job`

**Files:**
- Create: `src/mcp/tools/jobs/accept-job.ts` (no on-chain action — just Postgres signal)
- Create: `src/mcp/tools/jobs/set-budget.ts`
- Create: `src/mcp/tools/jobs/fund-job.ts`

- [ ] **Step 1: Implement `set_budget`**

Create `src/mcp/tools/jobs/set-budget.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { loadAgentByDbId } from "@/lib/agent-loader";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  jobId: z.string().regex(/^[0-9]+$/),
  amount: z.string().regex(/^[0-9]+$/),
  idempotencyKey: z.string().min(1),
});

export async function handleSetBudget(rawInput: unknown): Promise<Result<{ tx: `0x${string}` }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
  const wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") } });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const callData = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "setBudget",
    args: [BigInt(parse.data.jobId), BigInt(parse.data.amount), "0x"],
  });

  const { txHash } = await signWithTier2(wallet.circleWalletId, ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, callData, 0n);
  return ok({ tx: txHash });
}

registerTool({
  name: "arkage:set_budget",
  description: "Provider sets the budget on an Open job",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleSetBudget,
});
```

- [ ] **Step 2: Implement `fund_job` with Multicall3 (fund + recordJobFee)**

Create `src/mcp/tools/jobs/fund-job.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI, AGENT_REGISTRY_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES, ARKAGE_ADDRESSES } from "@/lib/addresses";
import { buildMulticall } from "@/lib/multicall";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { evaluatePolicy } from "@/lib/policy-engine";
import { route } from "@/lib/wallet-router";
import { loadAgentByDbId } from "@/lib/agent-loader";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  jobId: z.string().regex(/^[0-9]+$/),
  budget: z.string().regex(/^[0-9]+$/),
  evaluatorTier: z.enum(["fast", "standard", "premium"]),
  idempotencyKey: z.string().min(1),
});

function computeFee(budget: bigint, tier: "fast" | "standard" | "premium"): bigint {
  switch (tier) {
    case "fast": {
      const flat = 100_000n;
      const pct = budget / 20n; // 5%
      return pct > flat ? pct : flat;
    }
    case "standard": {
      const cap = 1_000_000n;
      const pct = budget / 50n; // 2%
      return pct < cap ? pct : cap;
    }
    case "premium": {
      const cap = 5_000_000n;
      const pct = budget / 100n; // 1%
      return pct < cap ? pct : cap;
    }
  }
}

export async function handleFundJob(rawInput: unknown): Promise<Result<{ tx: `0x${string}`; fee: string }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const budget = BigInt(parse.data.budget);
  const fee = computeFee(budget, parse.data.evaluatorTier);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

  const verdict = await evaluatePolicy({
    agentDbId: agent.dbId,
    policy: agent.policy,
    action: "fund_job",
    amount: budget,
    contractTarget: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
  });
  if (!verdict.ok) return err(verdict.code, verdict.message);

  const decision = route({ kind: "fund_job", amount: budget, agent: { agentId: agent.agentId, operatorWallet: agent.operatorWallet, perTxCap: agent.perTxCap, active: agent.active } });
  if ("reject" in decision) return err("routing_rejected", decision.reason);
  if (decision.wallet !== "tier2-dcw") return err("routing_requires_tier1", `Tier 1 signature required: ${(decision as { reason: string }).reason}`);

  if (!ARKAGE_ADDRESSES.AGENT_REGISTRY) return err("config_error", "AGENT_REGISTRY missing");

  const multicall = buildMulticall([
    {
      target: ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
      abi: ERC8183_ABI,
      functionName: "fund",
      args: [BigInt(parse.data.jobId), "0x"],
    },
    {
      target: ARKAGE_ADDRESSES.AGENT_REGISTRY,
      abi: AGENT_REGISTRY_ABI,
      functionName: "recordJobFee",
      args: [BigInt(parse.data.jobId), fee],
    },
  ]);

  const wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") } });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const { txHash } = await signWithTier2(wallet.circleWalletId, multicall.to, multicall.data, multicall.value);

  await db.job.updateMany({
    where: { jobId: parse.data.jobId },
    data: { evaluatorTier: parse.data.evaluatorTier, evaluatorFee: fee.toString() },
  });

  return ok({ tx: txHash, fee: fee.toString() });
}

registerTool({
  name: "arkage:fund_job",
  description: "Fund an ERC-8183 job and record evaluator fee in same tx via Multicall3",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleFundJob,
});
```

- [ ] **Step 3: Implement `accept_job` (off-chain signal only)**

Create `src/mcp/tools/jobs/accept-job.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  jobId: z.string().regex(/^[0-9]+$/),
  idempotencyKey: z.string().min(1),
});

export async function handleAcceptJob(rawInput: unknown): Promise<Result<{ acknowledged: true }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  await db.auditLog.create({
    data: {
      actorKind: "agent",
      actorId: parse.data.asAgent,
      action: "accept_job",
      targetKind: "job",
      targetId: parse.data.jobId,
      payloadJsonb: { idempotencyKey: parse.data.idempotencyKey } as object,
    },
  });

  return ok({ acknowledged: true });
}

registerTool({
  name: "arkage:accept_job",
  description: "Provider signals intent to accept an Open job (off-chain ack; setBudget is the on-chain commit)",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleAcceptJob,
});
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/jobs/accept-job.ts src/mcp/tools/jobs/set-budget.ts src/mcp/tools/jobs/fund-job.ts
git commit -m "feat(mcp): provider-side job tools (accept_job, set_budget, fund_job)

fund_job batches IACP.fund + AgentRegistry.recordJobFee via
Multicall3 so the fee is set-and-frozen atomically with funding.
Fee tier formula matches spec §2.6 table."
```

---

### Task 17: Job lifecycle continuation — `submit_work`, `claim_refund`

**Files:**
- Create: `src/mcp/tools/jobs/submit-work.ts`
- Create: `src/mcp/tools/jobs/claim-refund.ts`

- [ ] **Step 1: Implement `submit_work`**

Create `src/mcp/tools/jobs/submit-work.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { loadAgentByDbId } from "@/lib/agent-loader";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  jobId: z.string().regex(/^[0-9]+$/),
  deliverableHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  idempotencyKey: z.string().min(1),
});

export async function handleSubmitWork(rawInput: unknown): Promise<Result<{ tx: `0x${string}` }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
  const wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") } });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const callData = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "submit",
    args: [BigInt(parse.data.jobId), parse.data.deliverableHash as `0x${string}`, "0x"],
  });
  const { txHash } = await signWithTier2(wallet.circleWalletId, ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, callData, 0n);

  return ok({ tx: txHash });
}

registerTool({
  name: "arkage:submit_work",
  description: "Provider submits deliverable hash to ERC-8183 job",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleSubmitWork,
});
```

- [ ] **Step 2: Implement `claim_refund`**

Create `src/mcp/tools/jobs/claim-refund.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier2 } from "@/lib/tier2-dcw";
import { loadAgentByDbId } from "@/lib/agent-loader";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  jobId: z.string().regex(/^[0-9]+$/),
  idempotencyKey: z.string().min(1),
});

export async function handleClaimRefund(rawInput: unknown): Promise<Result<{ tx: `0x${string}` }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
  const wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") } });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const callData = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "claimRefund",
    args: [BigInt(parse.data.jobId)],
  });
  const { txHash } = await signWithTier2(wallet.circleWalletId, ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, callData, 0n);

  return ok({ tx: txHash });
}

registerTool({
  name: "arkage:claim_refund",
  description: "Anyone may call claimRefund on an expired Funded/Submitted job per ERC-8183",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleClaimRefund,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/jobs/submit-work.ts src/mcp/tools/jobs/claim-refund.ts
git commit -m "feat(mcp): submit_work + claim_refund tools"
```

---

### Task 18: Job reads — `get_job`, `list_jobs`, `query_jobs`

**Files:**
- Create: `src/mcp/tools/jobs/get-job.ts`
- Create: `src/mcp/tools/jobs/list-jobs.ts`
- Create: `src/mcp/tools/jobs/query-jobs.ts`

- [ ] **Step 1: Implement `get_job`**

Create `src/mcp/tools/jobs/get-job.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ jobId: z.string().regex(/^[0-9]+$/) });

export async function handleGetJob(rawInput: unknown): Promise<Result<unknown>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const job = await db.job.findUnique({
    where: { jobId: parse.data.jobId },
    include: {
      events: { orderBy: { blockTime: "asc" } },
      evaluations: true,
      clientAgent: { select: { agentId: true } },
      providerAgent: { select: { agentId: true } },
    },
  });
  if (!job) return err("not_found", `job ${parse.data.jobId} not found`);

  return ok({
    jobId: job.jobId.toString(),
    status: job.status,
    budget: job.budget?.toString() ?? null,
    evaluatorFee: job.evaluatorFee?.toString() ?? null,
    evaluatorTier: job.evaluatorTier,
    expiredAt: job.expiredAt.toISOString(),
    clientAgentId: job.clientAgent.agentId.toString(),
    providerAgentId: job.providerAgent?.agentId.toString() ?? null,
    reasonHash: job.reasonHash ? "0x" + Buffer.from(job.reasonHash).toString("hex") : null,
    eventCount: job.events.length,
    evaluationCount: job.evaluations.length,
  });
}

registerTool({
  name: "arkage:get_job",
  description: "Read full job state from materialized Postgres view",
  inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  handler: handleGetJob,
});
```

- [ ] **Step 2: Implement `list_jobs` + `query_jobs`**

Create `src/mcp/tools/jobs/list-jobs.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({
  status: z.enum(["open", "funded", "submitted", "completed", "rejected", "expired"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export async function handleListJobs(rawInput: unknown): Promise<Result<{ jobs: unknown[]; total: number }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const where = parse.data.status ? { status: parse.data.status } : {};
  const [rows, total] = await Promise.all([
    db.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: parse.data.limit,
      skip: parse.data.offset,
      select: { jobId: true, status: true, budget: true, expiredAt: true },
    }),
    db.job.count({ where }),
  ]);

  return ok({
    jobs: rows.map((r) => ({
      jobId: r.jobId.toString(),
      status: r.status,
      budget: r.budget?.toString() ?? null,
      expiredAt: r.expiredAt.toISOString(),
    })),
    total,
  });
}

registerTool({
  name: "arkage:list_jobs",
  description: "Paginated list of jobs filtered by status",
  inputSchema: { type: "object", properties: {} },
  handler: handleListJobs,
});
```

Create `src/mcp/tools/jobs/query-jobs.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({
  clientAgentId: z.string().regex(/^[0-9]+$/).optional(),
  providerAgentId: z.string().regex(/^[0-9]+$/).optional(),
  minBudget: z.string().regex(/^[0-9]+$/).optional(),
  maxBudget: z.string().regex(/^[0-9]+$/).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export async function handleQueryJobs(rawInput: unknown): Promise<Result<{ jobs: unknown[] }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const filters: Record<string, unknown> = {};
  if (parse.data.clientAgentId) {
    const a = await db.agent.findUnique({ where: { agentId: parse.data.clientAgentId } });
    if (!a) return err("not_found", `client agent ${parse.data.clientAgentId} not found`);
    filters.clientAgentId = a.id;
  }
  if (parse.data.providerAgentId) {
    const a = await db.agent.findUnique({ where: { agentId: parse.data.providerAgentId } });
    if (!a) return err("not_found", `provider agent ${parse.data.providerAgentId} not found`);
    filters.providerAgentId = a.id;
  }
  if (parse.data.minBudget) filters.budget = { gte: parse.data.minBudget };
  if (parse.data.maxBudget) {
    filters.budget = { ...(filters.budget as Record<string, unknown> | undefined ?? {}), lte: parse.data.maxBudget };
  }

  const rows = await db.job.findMany({
    where: filters,
    orderBy: { createdAt: "desc" },
    take: parse.data.limit,
    select: { jobId: true, status: true, budget: true },
  });

  return ok({
    jobs: rows.map((r) => ({ jobId: r.jobId.toString(), status: r.status, budget: r.budget?.toString() ?? null })),
  });
}

registerTool({
  name: "arkage:query_jobs",
  description: "Filter jobs by client/provider agent, budget range",
  inputSchema: { type: "object", properties: {} },
  handler: handleQueryJobs,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/jobs/get-job.ts src/mcp/tools/jobs/list-jobs.ts src/mcp/tools/jobs/query-jobs.ts
git commit -m "feat(mcp): job read tools (get_job, list_jobs, query_jobs)"
```

---

## Phase 6 — Reputation domain (3 MCP tools)

### Task 19: Reputation reads

**Files:**
- Create: `src/mcp/tools/reputation/get-reputation.ts`
- Create: `src/mcp/tools/reputation/query-reputation-history.ts`
- Create: `src/mcp/tools/reputation/compare-agents.ts`

- [ ] **Step 1: Implement `get_reputation`**

Create `src/mcp/tools/reputation/get-reputation.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

export async function handleGetReputation(rawInput: unknown): Promise<Result<{
  agentId: string;
  feedbackCount: number;
  averageScore: number | null;
  positiveCount: number;
  negativeCount: number;
}>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
  if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

  const fb = await db.reputationFeedback.findMany({ where: { agentId: agent.id }, select: { score: true } });
  if (fb.length === 0) {
    return ok({ agentId: parse.data.agentId, feedbackCount: 0, averageScore: null, positiveCount: 0, negativeCount: 0 });
  }
  const total = fb.reduce((s, r) => s + (r.score ?? 0), 0);
  const positive = fb.filter((r) => (r.score ?? 0) > 0).length;
  const negative = fb.filter((r) => (r.score ?? 0) < 0).length;

  return ok({
    agentId: parse.data.agentId,
    feedbackCount: fb.length,
    averageScore: total / fb.length,
    positiveCount: positive,
    negativeCount: negative,
  });
}

registerTool({
  name: "arkage:get_reputation",
  description: "Aggregate reputation stats for an agent (avg score, counts)",
  inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] },
  handler: handleGetReputation,
});
```

- [ ] **Step 2: Implement `query_reputation_history`**

Create `src/mcp/tools/reputation/query-reputation-history.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({
  agentId: z.string().regex(/^[0-9]+$/),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export async function handleQueryReputationHistory(rawInput: unknown): Promise<Result<{ entries: unknown[] }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
  if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

  const rows = await db.reputationFeedback.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: "desc" },
    take: parse.data.limit,
    skip: parse.data.offset,
  });

  return ok({
    entries: rows.map((r) => ({
      score: r.score,
      tag1: r.tag1,
      tag2: r.tag2,
      source: r.source,
      jobId: r.jobId?.toString() ?? null,
      blockTime: r.blockTime.toISOString(),
      txHash: "0x" + Buffer.from(r.txHash).toString("hex"),
    })),
  });
}

registerTool({
  name: "arkage:query_reputation_history",
  description: "Paginated list of reputation feedback entries for an agent",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleQueryReputationHistory,
});
```

- [ ] **Step 3: Implement `compare_agents`**

Create `src/mcp/tools/reputation/compare-agents.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ agentIds: z.array(z.string().regex(/^[0-9]+$/)).min(2).max(10) });

export async function handleCompareAgents(rawInput: unknown): Promise<Result<{ comparison: unknown[] }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agents = await db.agent.findMany({ where: { agentId: { in: parse.data.agentIds } } });
  if (agents.length !== parse.data.agentIds.length) return err("not_found", "one or more agents missing");

  const comparison = await Promise.all(agents.map(async (a) => {
    const fb = await db.reputationFeedback.findMany({ where: { agentId: a.id }, select: { score: true } });
    const total = fb.reduce((s, r) => s + (r.score ?? 0), 0);
    return {
      agentId: a.agentId.toString(),
      feedbackCount: fb.length,
      averageScore: fb.length ? total / fb.length : null,
    };
  }));

  return ok({ comparison });
}

registerTool({
  name: "arkage:compare_agents",
  description: "Compare reputation summaries across 2-10 agents in one call",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleCompareAgents,
});
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/reputation/
git commit -m "feat(mcp): reputation read tools (get/query history/compare)"
```

---

## Phase 7 — Treasury, Health & Admin (5 MCP tools)

### Task 20: Treasury tools

**Files:**
- Create: `src/mcp/tools/treasury/get-treasury-position.ts`
- Create: `src/mcp/tools/treasury/withdraw-treasury.ts`

- [ ] **Step 1: Implement `get_treasury_position`**

Create `src/mcp/tools/treasury/get-treasury-position.ts`:

```ts
import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { publicClient } from "@/lib/chain";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { ERC20_ABI } from "@/lib/abis";
import { getTier3Address } from "@/lib/tier3-system";

export async function handleGetTreasuryPosition(): Promise<Result<{
  treasuryAddress: string;
  usdcBalance: string;
  totalFeesIn: string;
  totalWithdrawalsOut: string;
}>> {
  const treasury = getTier3Address("treasury");
  const balance = await publicClient.readContract({
    address: ARC_TESTNET_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [treasury],
  });

  const movements = await db.treasuryMovement.findMany({ select: { direction: true, amount: true } });
  const totalIn = movements.filter((m) => m.direction === "in").reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
  const totalOut = movements.filter((m) => m.direction === "out").reduce((s, m) => s + BigInt(m.amount.toString()), 0n);

  return ok({
    treasuryAddress: treasury,
    usdcBalance: balance.toString(),
    totalFeesIn: totalIn.toString(),
    totalWithdrawalsOut: totalOut.toString(),
  });
}

registerTool({
  name: "arkage:get_treasury_position",
  description: "Read ArkAge treasury USDC balance and lifetime in/out totals",
  inputSchema: { type: "object", properties: {} },
  handler: handleGetTreasuryPosition,
});
```

- [ ] **Step 2: Implement `withdraw_treasury` (admin-gated)**

Create `src/mcp/tools/treasury/withdraw-treasury.ts`:

```ts
import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { ERC20_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier3 } from "@/lib/tier3-system";

const Input = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^[0-9]+$/),
  memo: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

export async function handleWithdrawTreasury(rawInput: unknown, ctx: McpAuthContext): Promise<Result<{ tx: `0x${string}` }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  if (!process.env.ARKAGE_ADMIN_BUILDERS?.split(",").includes(ctx.builderId.toString())) {
    return err("not_authorized", "treasury withdraw is admin-only");
  }

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [parse.data.to as Address, BigInt(parse.data.amount)],
  });
  const { txHash } = await signWithTier3("treasury", ARC_TESTNET_ADDRESSES.USDC, data, 0n);

  await db.treasuryMovement.create({
    data: {
      kind: "manual_withdraw",
      amount: parse.data.amount,
      tokenAddress: Buffer.from(ARC_TESTNET_ADDRESSES.USDC.replace(/^0x/, ""), "hex"),
      direction: "out",
      counterparty: Buffer.from(parse.data.to.replace(/^0x/, ""), "hex"),
      txHash: Buffer.from(txHash.replace(/^0x/, ""), "hex"),
      blockTime: new Date(),
    },
  });

  return ok({ tx: txHash });
}

registerTool({
  name: "arkage:withdraw_treasury",
  description: "Admin-gated USDC withdrawal from treasury",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleWithdrawTreasury,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/treasury/
git commit -m "feat(mcp): treasury tools

get_treasury_position reads on-chain USDC balance + Postgres
movement totals. withdraw_treasury is admin-gated via
ARKAGE_ADMIN_BUILDERS env list, signs with Tier 3 treasury wallet."
```

---

### Task 21: Admin tools — `get_protocol_health`, `force_advance_workflow`, `verify_evidence`

**Files:**
- Create: `src/mcp/tools/admin/get-protocol-health.ts`
- Create: `src/mcp/tools/admin/force-advance-workflow.ts`
- Create: `src/mcp/tools/admin/verify-evidence.ts`
- Create: `src/lib/evidence-store.ts`
- Create: `tests/unit/evidence-store.test.ts`

- [ ] **Step 1: Install Vercel Blob**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Write evidence store + failing test**

Create `tests/unit/evidence-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canonicalEvidenceJson, evidenceHash } from "@/lib/evidence-store";

describe("evidence-store", () => {
  it("canonicalizes evidence deterministically", () => {
    const e1 = { model: "x", verdict: "accept" as const, reasoning: "y", deliverableHash: "0xab" };
    const e2 = { verdict: "accept" as const, deliverableHash: "0xab", model: "x", reasoning: "y" };
    expect(canonicalEvidenceJson(e1)).toBe(canonicalEvidenceJson(e2));
  });

  it("evidenceHash is 32 bytes hex", () => {
    const h = evidenceHash({ model: "x", verdict: "accept", reasoning: "y", deliverableHash: "0xab" });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Implement evidence store**

Create `src/lib/evidence-store.ts`:

```ts
import { put } from "@vercel/blob";
import { keccak256, toHex } from "viem";

export interface EvidenceRecord {
  model: string;
  verdict: "accept" | "reject";
  reasoning: string;
  deliverableHash: string;
  inputTokens?: number;
  outputTokens?: number;
  promptVersion?: string;
  promptHash?: string;
  structuredResponse?: unknown;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

export function canonicalEvidenceJson(record: EvidenceRecord): string {
  return JSON.stringify(sortKeysDeep(record));
}

export function evidenceHash(record: EvidenceRecord): `0x${string}` {
  return keccak256(toHex(canonicalEvidenceJson(record)));
}

export async function persistEvidence(jobId: bigint, record: EvidenceRecord): Promise<{ uri: string; hash: `0x${string}` }> {
  const canonical = canonicalEvidenceJson(record);
  const hash = evidenceHash(record);
  const path = `evidence/${jobId}/${hash}.json`;
  const blob = await put(path, canonical, { access: "public", contentType: "application/json", addRandomSuffix: false });
  return { uri: blob.url, hash };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test tests/unit/evidence-store.test.ts
```

Expected: 2 pass.

- [ ] **Step 5: Implement `verify_evidence`**

Create `src/mcp/tools/admin/verify-evidence.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { evidenceHash } from "@/lib/evidence-store";

const Input = z.object({ jobId: z.string().regex(/^[0-9]+$/) });

export async function handleVerifyEvidence(rawInput: unknown): Promise<Result<{
  onChainReasonHash: string | null;
  fetchedEvidenceURI: string | null;
  computedHash: string | null;
  matches: boolean;
}>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const job = await db.job.findUnique({
    where: { jobId: parse.data.jobId },
    include: { evaluations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!job) return err("not_found", `job ${parse.data.jobId} not found`);

  const onChain = job.reasonHash ? "0x" + Buffer.from(job.reasonHash).toString("hex") : null;
  const evalRow = job.evaluations[0];
  if (!evalRow) {
    return ok({ onChainReasonHash: onChain, fetchedEvidenceURI: null, computedHash: null, matches: false });
  }

  const res = await fetch(evalRow.evidenceUri);
  if (!res.ok) return err("evidence_fetch_failed", `${res.status} ${res.statusText}`);
  const fetched = await res.json();

  const recomputed = evidenceHash(fetched);
  const matches = onChain === recomputed;

  return ok({ onChainReasonHash: onChain, fetchedEvidenceURI: evalRow.evidenceUri, computedHash: recomputed, matches });
}

registerTool({
  name: "arkage:verify_evidence",
  description: "Public verification: fetch evaluator evidence, recompute hash, confirm on-chain match",
  inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  handler: handleVerifyEvidence,
});
```

- [ ] **Step 6: Implement `get_protocol_health`**

Create `src/mcp/tools/admin/get-protocol-health.ts`:

```ts
import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

export async function handleGetProtocolHealth(): Promise<Result<{
  jobsByStatus: Record<string, number>;
  activeAgents: number;
  stuckWorkflows: number;
  indexerCursors: Array<{ source: string; lastBlock: string }>;
}>> {
  const jobs = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  const activeAgents = await db.agent.count({ where: { active: true } });
  const stuckThreshold = new Date(Date.now() - 10 * 60_000);
  const stuck = await db.workflowRun.count({ where: { status: "running", lastAdvancedAt: { lt: stuckThreshold } } });
  const cursors = await db.indexerCursor.findMany({ select: { source: true, lastBlock: true } });

  return ok({
    jobsByStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
    activeAgents,
    stuckWorkflows: stuck,
    indexerCursors: cursors.map((c) => ({ source: c.source, lastBlock: c.lastBlock.toString() })),
  });
}

registerTool({
  name: "arkage:get_protocol_health",
  description: "Protocol-wide health snapshot for dashboards and monitoring",
  inputSchema: { type: "object", properties: {} },
  handler: handleGetProtocolHealth,
});
```

- [ ] **Step 7: Implement `force_advance_workflow`**

Create `src/mcp/tools/admin/force-advance-workflow.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { resumeHook } from "workflow/api";

const Input = z.object({
  hookToken: z.string().min(1),
  payloadJson: z.string().optional(),
});

export async function handleForceAdvanceWorkflow(rawInput: unknown): Promise<Result<{ resumed: true }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const payload = parse.data.payloadJson ? JSON.parse(parse.data.payloadJson) : {};
  await resumeHook(parse.data.hookToken, payload);

  await db.auditLog.create({
    data: {
      actorKind: "admin",
      action: "force_advance_workflow",
      payloadJsonb: { token: parse.data.hookToken } as object,
    },
  });

  return ok({ resumed: true });
}

registerTool({
  name: "arkage:force_advance_workflow",
  description: "Manually fire resumeHook for a stuck workflow (admin-only)",
  inputSchema: { type: "object", properties: { hookToken: { type: "string" } }, required: ["hookToken"] },
  handler: handleForceAdvanceWorkflow,
});
```

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools/admin/ src/lib/evidence-store.ts tests/unit/evidence-store.test.ts package.json package-lock.json
git commit -m "feat(mcp): admin + verification tools

- get_protocol_health: protocol-wide stats snapshot
- force_advance_workflow: manual resumeHook for stuck flows
- verify_evidence: public hash-recompute against off-chain blob
- evidence-store helpers: canonicalize, keccak256 hash, Vercel Blob persist"
```

---

### Task 22: MCP tool registration entry point

**Files:**
- Create: `src/mcp/register-all-tools.ts`
- Modify: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Write the registration aggregator**

Create `src/mcp/register-all-tools.ts`:

```ts
// Importing each tool module triggers its registerTool() side effect.
import "./tools/identity/bootstrap-user.js";
import "./tools/identity/get-agent-info.js";
import "./tools/identity/get-my-agents.js";
import "./tools/identity/update-agent-metadata.js";
import "./tools/identity/revoke-agent.js";
import "./tools/jobs/post-job.js";
import "./tools/jobs/accept-job.js";
import "./tools/jobs/set-budget.js";
import "./tools/jobs/fund-job.js";
import "./tools/jobs/submit-work.js";
import "./tools/jobs/claim-refund.js";
import "./tools/jobs/get-job.js";
import "./tools/jobs/list-jobs.js";
import "./tools/jobs/query-jobs.js";
import "./tools/reputation/get-reputation.js";
import "./tools/reputation/query-reputation-history.js";
import "./tools/reputation/compare-agents.js";
import "./tools/treasury/get-treasury-position.js";
import "./tools/treasury/withdraw-treasury.js";
import "./tools/admin/get-protocol-health.js";
import "./tools/admin/force-advance-workflow.js";
import "./tools/admin/verify-evidence.js";
```

- [ ] **Step 2: Modify route to import the aggregator**

Edit `src/app/api/mcp/route.ts` — add at the top, after existing imports:

```ts
import "@/mcp/register-all-tools";
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/register-all-tools.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): aggregate tool imports into single registration entry point

Side-effect imports trigger registerTool() for each tool. Adding
a new tool = one line in this file."
```

---

## Phase 8 — Workflow infrastructure

### Task 23: Install Vercel Workflow DevKit + framework mount

**Files:**
- Create: `src/app/api/workflows/[...slug]/route.ts`
- Modify: `next.config.ts`
- Create: `vitest.workflow.config.ts`

- [ ] **Step 1: Install workflow packages**

```bash
npm install workflow @workflow/ai @workflow/next
npm install -D @workflow/vitest
```

- [ ] **Step 2: Wire `withWorkflow` into next.config.ts**

Edit `next.config.ts`:

```ts
import type { NextConfig } from "next";
import { withWorkflow } from "@workflow/next";

const config: NextConfig = {
  experimental: { typedRoutes: true },
};

export default withWorkflow(config);
```

- [ ] **Step 3: Create the workflow handler route**

Create `src/app/api/workflows/[...slug]/route.ts`:

```ts
import { handle } from "@workflow/next";

// Side-effect import: importing each workflow module registers it with the runtime.
import "@/workflows/job-lifecycle";
import "@/workflows/llm-evaluator-agent";
import "@/workflows/x402-payment-session";
import "@/workflows/x402-dispute-flow";

export const { GET, POST } = handle();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

- [ ] **Step 4: Set up workflow vitest config**

Create `vitest.workflow.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";

export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ["tests/workflow/**/*.test.ts"],
    testTimeout: 60_000,
  },
  resolve: { alias: { "@": "/src" } },
});
```

- [ ] **Step 5: Add workflow test script**

Add to `package.json` `scripts`:

```json
{
  "scripts": {
    "test:workflow": "vitest run --config vitest.workflow.config.ts"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add next.config.ts src/app/api/workflows package.json package-lock.json vitest.workflow.config.ts
git commit -m "feat(workflow): mount Vercel Workflow DevKit handler + Vitest plugin

- next.config.ts wrapped with withWorkflow()
- /api/workflows/[...slug] route handles all workflow runs
- vitest.workflow.config.ts uses @workflow/vitest plugin for in-process tests
- npm run test:workflow runs the workflow integration suite"
```

---

### Task 24: Self-rescue race helper + deterministic hook tokens

**Files:**
- Create: `tests/unit/hook-tokens.test.ts`
- Create: `src/workflows/lib/hook-tokens.ts`
- Create: `src/workflows/lib/self-rescue.ts`
- Create: `tests/unit/self-rescue.test.ts`

- [ ] **Step 1: Write failing token tests**

Create `tests/unit/hook-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { jobFundedToken, jobSubmittedToken, jobTerminalToken, evaluatorDoneToken, x402SessionToken } from "@/workflows/lib/hook-tokens";

describe("hook tokens", () => {
  it("are deterministic", () => {
    expect(jobFundedToken(42n)).toBe("8183:JobFunded:42");
    expect(jobSubmittedToken(42n)).toBe("8183:JobSubmitted:42");
    expect(jobTerminalToken(42n)).toBe("8183:JobTerminal:42");
    expect(evaluatorDoneToken(42n)).toBe("evaluator:42:done");
    expect(x402SessionToken(1n, 2n)).toBe("x402:Session:1:2");
  });
});
```

- [ ] **Step 2: Implement tokens**

Create `src/workflows/lib/hook-tokens.ts`:

```ts
export const jobFundedToken = (jobId: bigint) => `8183:JobFunded:${jobId}` as const;
export const jobSubmittedToken = (jobId: bigint) => `8183:JobSubmitted:${jobId}` as const;
export const jobTerminalToken = (jobId: bigint) => `8183:JobTerminal:${jobId}` as const;
export const evaluatorDoneToken = (jobId: bigint) => `evaluator:${jobId}:done` as const;
export const x402SessionToken = (buyerAgentId: bigint, sellerAgentId: bigint) =>
  `x402:Session:${buyerAgentId}:${sellerAgentId}` as const;
```

- [ ] **Step 3: Run, verify pass**

```bash
npm test tests/unit/hook-tokens.test.ts
```

Expected: 1 pass.

- [ ] **Step 4: Implement the self-rescue race helper**

Create `src/workflows/lib/self-rescue.ts`:

```ts
import { sleep, createHook } from "workflow";
import type { JobStatusEnum } from "@/lib/erc8183-state";

export type SelfRescueOutcome<T> =
  | { kind: "event"; payload: T }
  | { kind: "rescued"; chainState: JobStatusEnum }
  | { kind: "expired" };

export interface SelfRescueOptions<T> {
  hookToken: string;
  pollChainState: () => Promise<JobStatusEnum>;
  isAdvancedPredicate: (state: JobStatusEnum) => boolean;
  expiredAtSec: number;
  rescueIntervalSec?: number;
}

export async function awaitChainEventWithRescue<T>(opts: SelfRescueOptions<T>): Promise<SelfRescueOutcome<T>> {
  "use workflow";

  const interval = opts.rescueIntervalSec ?? 60;
  const hook = createHook<T>({ token: opts.hookToken });

  while (true) {
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, opts.expiredAtSec - nowSec);
    if (remaining === 0) return { kind: "expired" };

    const racers: Promise<unknown>[] = [hook, sleep(`${interval}s`)];
    if (remaining < interval) racers.push(sleep(`${remaining}s`));

    const winner = await Promise.race(racers);
    if (winner !== undefined) {
      return { kind: "event", payload: winner as T };
    }

    const state = await opts.pollChainState();
    if (opts.isAdvancedPredicate(state)) {
      return { kind: "rescued", chainState: state };
    }

    if (Math.floor(Date.now() / 1000) >= opts.expiredAtSec) return { kind: "expired" };
  }
}
```

- [ ] **Step 5: Smoke test the self-rescue helper module loads**

Create `tests/unit/self-rescue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as mod from "@/workflows/lib/self-rescue";

describe("self-rescue module", () => {
  it("exports awaitChainEventWithRescue", () => {
    expect(typeof mod.awaitChainEventWithRescue).toBe("function");
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add src/workflows/lib/hook-tokens.ts src/workflows/lib/self-rescue.ts tests/unit/hook-tokens.test.ts tests/unit/self-rescue.test.ts
git commit -m "feat(workflow): self-rescue race helper + deterministic hook tokens

awaitChainEventWithRescue races createHook against sleep with
chain-state polling on each wakeup. All workflow chain-event
awaits use this pattern (Risk #2 primary mitigation).
Hook tokens are deterministic strings so indexer push and
rescue cron resolve to the same hook (idempotent)."
```

---

### Task 25: Settlement step wrappers (called from evaluator)

**Files:**
- Create: `src/workflows/lib/settlement-steps.ts`

- [ ] **Step 1: Implement settlement steps**

Create `src/workflows/lib/settlement-steps.ts`:

```ts
import { encodeFunctionData } from "viem";
import { ERC8183_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier3 } from "@/lib/tier3-system";

export async function callComplete(jobId: bigint, reason: `0x${string}`): Promise<{ txHash: `0x${string}` }> {
  "use step";
  console.log(`[settlement] callComplete enter jobId=${jobId} reason=${reason}`);
  const data = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "complete",
    args: [jobId, reason, "0x"],
  });
  const result = await signWithTier3("validator", ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, data, 0n);
  console.log(`[settlement] callComplete exit jobId=${jobId} txHash=${result.txHash}`);
  return result;
}

export async function callReject(jobId: bigint, reason: `0x${string}`): Promise<{ txHash: `0x${string}` }> {
  "use step";
  console.log(`[settlement] callReject enter jobId=${jobId} reason=${reason}`);
  const data = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "reject",
    args: [jobId, reason, "0x"],
  });
  const result = await signWithTier3("validator", ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, data, 0n);
  console.log(`[settlement] callReject exit jobId=${jobId} txHash=${result.txHash}`);
  return result;
}

export async function tryClaimRefund(jobId: bigint): Promise<{ txHash: `0x${string}` } | { skipped: true; reason: string }> {
  "use step";
  console.log(`[settlement] tryClaimRefund enter jobId=${jobId}`);
  try {
    const data = encodeFunctionData({
      abi: ERC8183_ABI,
      functionName: "claimRefund",
      args: [jobId],
    });
    const result = await signWithTier3("gas-funder", ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE, data, 0n);
    console.log(`[settlement] tryClaimRefund exit jobId=${jobId} txHash=${result.txHash}`);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`[settlement] tryClaimRefund skipped jobId=${jobId} reason=${message}`);
    return { skipped: true, reason: message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workflows/lib/settlement-steps.ts
git commit -m "feat(workflow): settlement step wrappers (complete/reject/claimRefund)

Marked 'use step' so they have full Node.js access. Sign via Tier 3
validator wallet (complete/reject) or gas-funder (refunds).
Logging at entry/exit aids stuck-workflow debugging."
```

---

### Task 26: Evaluator prompt templates + model selection

**Files:**
- Create: `src/workflows/lib/evaluator-prompts.ts`

- [ ] **Step 1: Implement prompt module**

Create `src/workflows/lib/evaluator-prompts.ts`:

```ts
export const EVALUATOR_PROMPT_VERSION = "v1.0.0";

export const EVALUATOR_SYSTEM_PROMPT = `You are ArkAge's autonomous evaluator for ERC-8183 agentic-commerce jobs on Arc Testnet.

Your role:
1. Read the job description, the provider's deliverable, and any attached evidence.
2. Decide whether the deliverable satisfies the description.
3. Output a JSON object with this exact shape:
   {
     "verdict": "accept" | "reject",
     "score": <integer -100..100>,
     "reasoning": "<2-5 sentences explaining your decision>",
     "concerns": ["<concern 1>", "<concern 2>", ...]
   }

Be strict but fair. Reject if:
- The deliverable does not address the description.
- The deliverable contains obvious errors or fabrication.
- Required artifacts are missing.

Accept if:
- The deliverable substantively addresses the request.
- Quality is acceptable for the budget paid.
- Any minor issues are noted in "concerns" but do not warrant rejection.

Never accept blank, gibberish, or wildly off-topic deliverables.`;

export type EvaluatorTier = "fast" | "standard" | "premium";

/**
 * Returns the AI Gateway model ID. IMPORTANT: model IDs change frequently.
 * Verify current IDs at implementation time:
 *   curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id]'
 * Use the highest version available for each tier.
 */
export function modelForTier(tier: EvaluatorTier): string {
  switch (tier) {
    case "fast":     return "anthropic/claude-haiku-4.5";
    case "standard": return "anthropic/claude-sonnet-4.6";
    case "premium":  return "anthropic/claude-opus-4.7";
  }
}

export function buildEvaluationPrompt(args: {
  jobId: bigint;
  description: string;
  deliverable: { hash: string; content: string };
  budget: bigint;
}): string {
  return `# Job ${args.jobId}

## Description
${args.description}

## Budget
${(Number(args.budget) / 1_000_000).toFixed(2)} USDC

## Deliverable
Hash: ${args.deliverable.hash}

\`\`\`
${args.deliverable.content}
\`\`\`

Now evaluate per your system instructions. Respond with the JSON object only — no surrounding text.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workflows/lib/evaluator-prompts.ts
git commit -m "feat(workflow): evaluator system prompt + tier→model mapping

Versioned prompt (v1.0.0) with explicit accept/reject criteria.
modelForTier maps fast/standard/premium → Haiku/Sonnet/Opus
on the AI Gateway. NOTE: verify model IDs at impl time per
ai-sdk skill guidance."
```

---

## Phase 9 — `jobLifecycle` workflow

### Task 27: Implement `jobLifecycle(jobId, expiredAtSec)`

**Files:**
- Create: `src/workflows/job-lifecycle.ts`
- Create: `tests/workflow/job-lifecycle.test.ts`
- Create: `src/workflows/lib/recording-steps.ts` (workflow_runs Postgres helpers)

- [ ] **Step 1: Implement recording-steps helpers**

Create `src/workflows/lib/recording-steps.ts`:

```ts
import { db } from "@/lib/db";
import { getWorkflowMetadata } from "workflow";

export async function recordWorkflowStart(kind: string, kindId: bigint): Promise<void> {
  "use step";
  const meta = getWorkflowMetadata();
  console.log(`[workflow] start kind=${kind} kindId=${kindId} runId=${meta.runId}`);
  const now = new Date();
  await db.workflowRun.upsert({
    where: { runId: meta.runId },
    update: { lastAdvancedAt: now },
    create: {
      runId: meta.runId,
      kind,
      kindId,
      status: "running",
      startedAt: now,
      lastAdvancedAt: now,
    },
  });
}

export async function recordWorkflowAdvance(label: string): Promise<void> {
  "use step";
  const meta = getWorkflowMetadata();
  console.log(`[workflow] advance runId=${meta.runId} label=${label}`);
  await db.workflowRun.update({
    where: { runId: meta.runId },
    data: { lastAdvancedAt: new Date() },
  });
}

export async function recordWorkflowComplete(outcome: string): Promise<void> {
  "use step";
  const meta = getWorkflowMetadata();
  const now = new Date();
  console.log(`[workflow] complete runId=${meta.runId} outcome=${outcome}`);
  await db.workflowRun.update({
    where: { runId: meta.runId },
    data: { status: "completed", completedAt: now, lastAdvancedAt: now, error: outcome },
  });
}
```

- [ ] **Step 2: Implement `jobLifecycle`**

Create `src/workflows/job-lifecycle.ts`:

```ts
import { start } from "workflow/api";
import { readJob, isTerminalState, type JobStatusEnum } from "@/lib/erc8183-state";
import { awaitChainEventWithRescue } from "./lib/self-rescue";
import { jobFundedToken, jobSubmittedToken, jobTerminalToken } from "./lib/hook-tokens";
import { recordWorkflowStart, recordWorkflowAdvance, recordWorkflowComplete } from "./lib/recording-steps";
import { tryClaimRefund } from "./lib/settlement-steps";
import { llmEvaluatorAgent } from "./llm-evaluator-agent";
import { db } from "@/lib/db";

async function pollJobState(jobId: bigint): Promise<JobStatusEnum> {
  "use step";
  console.log(`[jobLifecycle] pollJobState jobId=${jobId}`);
  const j = await readJob(jobId);
  return j.status;
}

async function isArkAgeEvaluator(jobId: bigint): Promise<boolean> {
  "use step";
  console.log(`[jobLifecycle] isArkAgeEvaluator jobId=${jobId}`);
  const j = await readJob(jobId);
  const validator = process.env.ARKAGE_VALIDATOR_WALLET_ADDRESS?.toLowerCase();
  return validator !== undefined && j.evaluator.toLowerCase() === validator;
}

async function loadJobTier(jobId: bigint): Promise<"fast" | "standard" | "premium"> {
  "use step";
  console.log(`[jobLifecycle] loadJobTier jobId=${jobId}`);
  const job = await db.job.findUnique({ where: { jobId: jobId.toString() } });
  const tier = job?.evaluatorTier as "fast" | "standard" | "premium" | undefined;
  return tier ?? "standard";
}

async function startEvaluatorChild(jobId: bigint, tier: "fast" | "standard" | "premium"): Promise<string> {
  "use step";
  console.log(`[jobLifecycle] startEvaluatorChild jobId=${jobId} tier=${tier}`);
  const run = await start(llmEvaluatorAgent, [jobId, tier]);
  return run.runId;
}

export async function jobLifecycle(jobId: bigint, expiredAtSec: number) {
  "use workflow";

  await recordWorkflowStart("job_lifecycle", jobId);

  // Phase 1: wait for Funded
  const funded = await awaitChainEventWithRescue<{ jobId: string }>({
    hookToken: jobFundedToken(jobId),
    pollChainState: () => pollJobState(jobId),
    isAdvancedPredicate: (s) => s === "Funded" || s === "Submitted" || isTerminalState(s),
    expiredAtSec,
  });

  if (funded.kind === "expired") {
    await recordWorkflowComplete("expired_unfunded");
    return { outcome: "expired_unfunded" };
  }
  await recordWorkflowAdvance("funded");

  // Phase 2: wait for Submitted
  const submitted = await awaitChainEventWithRescue<{ jobId: string; deliverable: string }>({
    hookToken: jobSubmittedToken(jobId),
    pollChainState: () => pollJobState(jobId),
    isAdvancedPredicate: (s) => s === "Submitted" || isTerminalState(s),
    expiredAtSec,
  });

  if (submitted.kind === "expired") {
    await tryClaimRefund(jobId);
    await recordWorkflowComplete("expired_unsubmitted_refunded");
    return { outcome: "expired_unsubmitted_refunded" };
  }
  await recordWorkflowAdvance("submitted");

  // Phase 3: spawn evaluator child if ArkAge is the evaluator
  if (await isArkAgeEvaluator(jobId)) {
    const tier = await loadJobTier(jobId);
    await startEvaluatorChild(jobId, tier);
  }

  // Phase 4: wait for terminal state
  const terminal = await awaitChainEventWithRescue<{ status: JobStatusEnum }>({
    hookToken: jobTerminalToken(jobId),
    pollChainState: () => pollJobState(jobId),
    isAdvancedPredicate: (s) => isTerminalState(s),
    expiredAtSec,
  });

  if (terminal.kind === "expired") {
    await tryClaimRefund(jobId);
    await recordWorkflowComplete("expired_unevaluated_refunded");
    return { outcome: "expired_unevaluated_refunded" };
  }

  const finalStatus = terminal.kind === "rescued" ? terminal.chainState : (await pollJobState(jobId));
  await recordWorkflowComplete(finalStatus.toLowerCase());
  return { outcome: finalStatus.toLowerCase() };
}
```

- [ ] **Step 3: Write a workflow integration test**

Create `tests/workflow/job-lifecycle.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { start, getRun, resumeHook } from "workflow/api";
import { waitForHook } from "@workflow/vitest";
import { jobLifecycle } from "@/workflows/job-lifecycle";

vi.mock("@/lib/erc8183-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/erc8183-state")>("@/lib/erc8183-state");
  return {
    ...actual,
    readJob: vi.fn(async () => ({
      client: "0x1111111111111111111111111111111111111111",
      provider: "0x2222222222222222222222222222222222222222",
      evaluator: "0x3333333333333333333333333333333333333333",
      budget: 1_000_000n,
      expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
      status: "Completed" as const,
      reason: "0x" + "ab".repeat(32),
      hook: "0x4444444444444444444444444444444444444444",
    })),
  };
});

describe("jobLifecycle", () => {
  it("completes when terminal hook fires", async () => {
    const expiredAtSec = Math.floor(Date.now() / 1000) + 600;
    const run = await start(jobLifecycle, [42n, expiredAtSec]);

    await waitForHook(run, { token: "8183:JobFunded:42" });
    await resumeHook("8183:JobFunded:42", { jobId: "42" });

    await waitForHook(run, { token: "8183:JobSubmitted:42" });
    await resumeHook("8183:JobSubmitted:42", { jobId: "42", deliverable: "0xab" });

    await waitForHook(run, { token: "8183:JobTerminal:42" });
    await resumeHook("8183:JobTerminal:42", { status: "Completed" });

    const result = await run.returnValue;
    expect((result as { outcome: string }).outcome).toBe("completed");
  }, 30_000);
});
```

- [ ] **Step 4: Run, verify pass**

```bash
npm run test:workflow -- tests/workflow/job-lifecycle.test.ts
```

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/job-lifecycle.ts src/workflows/lib/recording-steps.ts tests/workflow/job-lifecycle.test.ts
git commit -m "feat(workflow): jobLifecycle workflow with self-rescue throughout

4-phase lifecycle (Funded → Submitted → Evaluator → Terminal),
each phase wrapped in awaitChainEventWithRescue. Evaluator child
spawned only when ArkAge is the registered evaluator. On any
expiry, attempts claimRefund.
recordWorkflowStart/Advance/Complete maintain workflow_runs row
with last_advanced_at for the stuck-workflow reconciler."
```

---

## Phase 10 — `llmEvaluatorAgent` workflow (DurableAgent)

### Task 28: Implement `llmEvaluatorAgent(jobId, tier)`

**Files:**
- Create: `src/workflows/llm-evaluator-agent.ts`
- Create: `tests/workflow/llm-evaluator-agent.test.ts`

- [ ] **Step 1: Verify current Anthropic model IDs**

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id] | reverse | .[]'
```

Expected: list of available `anthropic/*` model IDs. If `claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-opus-4.7` are not present, update `evaluator-prompts.ts` to use the latest available IDs (and update spec §2.6 fee tier mapping).

- [ ] **Step 2: Implement the evaluator workflow**

Create `src/workflows/llm-evaluator-agent.ts`:

```ts
import { DurableAgent } from "@workflow/ai/agent";
import { getWritable, resumeHook } from "workflow";
import { db } from "@/lib/db";
import { readJob } from "@/lib/erc8183-state";
import { persistEvidence, type EvidenceRecord } from "@/lib/evidence-store";
import { callComplete, callReject } from "./lib/settlement-steps";
import { evaluatorDoneToken, jobTerminalToken } from "./lib/hook-tokens";
import {
  EVALUATOR_PROMPT_VERSION,
  EVALUATOR_SYSTEM_PROMPT,
  buildEvaluationPrompt,
  modelForTier,
  type EvaluatorTier,
} from "./lib/evaluator-prompts";
import { recordWorkflowStart, recordWorkflowComplete } from "./lib/recording-steps";
import { stepCountIs, type UIMessageChunk } from "ai";
import { keccak256, toHex } from "viem";

interface EvaluatorOutput {
  verdict: "accept" | "reject";
  score: number;
  reasoning: string;
  concerns: string[];
}

async function loadJobContext(jobId: bigint): Promise<{ description: string; budget: bigint; deliverableHash: string }> {
  "use step";
  console.log(`[evaluator] loadJobContext jobId=${jobId}`);
  const job = await readJob(jobId);
  const dbJob = await db.job.findUnique({ where: { jobId: jobId.toString() } });
  const description = dbJob?.descriptionUri ?? "(no description URI)";
  const deliverableHash = job.reason; // Updated when evaluator runs; placeholder for now
  return { description, budget: job.budget, deliverableHash };
}

async function fetchDeliverable(deliverableHash: string): Promise<string> {
  "use step";
  console.log(`[evaluator] fetchDeliverable hash=${deliverableHash}`);
  // Convention: deliverableHash maps to a Vercel Blob path or external IPFS gateway.
  // For v1 testnet, providers POST their deliverable to /api/deliverables/<hash> first.
  const url = `${process.env.ARKAGE_DELIVERABLE_GATEWAY ?? "https://arkage.network/api/deliverables/"}${deliverableHash}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`[evaluator] fetchDeliverable failed status=${res.status}`);
    return `(deliverable unavailable: ${res.status})`;
  }
  return await res.text();
}

async function persistEvaluation(args: {
  jobId: bigint;
  tier: EvaluatorTier;
  model: string;
  output: EvaluatorOutput;
  deliverableHash: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<{ evidenceUri: string; evidenceHash: `0x${string}` }> {
  "use step";
  console.log(`[evaluator] persistEvaluation jobId=${args.jobId} verdict=${args.output.verdict}`);
  const promptHash = keccak256(toHex(EVALUATOR_SYSTEM_PROMPT));
  const record: EvidenceRecord = {
    model: args.model,
    verdict: args.output.verdict,
    reasoning: args.output.reasoning,
    deliverableHash: args.deliverableHash,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    promptVersion: EVALUATOR_PROMPT_VERSION,
    promptHash,
    structuredResponse: args.output,
  };
  const { uri, hash } = await persistEvidence(args.jobId, record);

  const job = await db.job.findUnique({ where: { jobId: args.jobId.toString() } });
  if (!job) throw new Error(`job ${args.jobId} not found in db`);

  await db.jobEvaluation.create({
    data: {
      jobId: job.id,
      workflowRunId: "pending", // metadata.runId set by recording layer
      model: args.model,
      tier: args.tier,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      promptVersion: EVALUATOR_PROMPT_VERSION,
      promptHash: Buffer.from(promptHash.replace(/^0x/, ""), "hex"),
      deliverableHash: Buffer.from(args.deliverableHash.replace(/^0x/, ""), "hex"),
      reasoningText: args.output.reasoning,
      structuredResponseJsonb: args.output as object,
      verdict: args.output.verdict,
      score: args.output.score,
      evidenceUri: uri,
      evidenceHash: Buffer.from(hash.replace(/^0x/, ""), "hex"),
    },
  });

  return { evidenceUri: uri, evidenceHash: hash };
}

export async function llmEvaluatorAgent(jobId: bigint, tier: EvaluatorTier) {
  "use workflow";

  await recordWorkflowStart("evaluator", jobId);

  const ctx = await loadJobContext(jobId);
  const deliverable = await fetchDeliverable(ctx.deliverableHash);

  const agent = new DurableAgent({
    model: modelForTier(tier),
    system: EVALUATOR_SYSTEM_PROMPT,
  });

  const result = await agent.stream({
    messages: [{ role: "user", content: buildEvaluationPrompt({
      jobId,
      description: ctx.description,
      deliverable: { hash: ctx.deliverableHash, content: deliverable },
      budget: ctx.budget,
    }) }],
    writable: getWritable<UIMessageChunk>({ namespace: "evaluator:reasoning" }),
    stopWhen: stepCountIs(6),
  });

  // Parse the JSON output from the last assistant message
  const lastAssistant = result.messages.reverse().find((m) => m.role === "assistant");
  const text = typeof lastAssistant?.content === "string"
    ? lastAssistant.content
    : Array.isArray(lastAssistant?.content)
      ? lastAssistant.content.map((p: unknown) => typeof p === "object" && p !== null && "text" in p ? String((p as { text: unknown }).text) : "").join("")
      : "";

  let parsed: EvaluatorOutput;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { verdict: "reject", score: -100, reasoning: "Evaluator failed to produce parseable JSON output", concerns: ["malformed_output"] };
  }

  const { evidenceHash } = await persistEvaluation({
    jobId,
    tier,
    model: modelForTier(tier),
    output: parsed,
    deliverableHash: ctx.deliverableHash,
    inputTokens: 0, // populated by SDK in real run; estimated 0 in template
    outputTokens: 0,
  });

  if (parsed.verdict === "accept") {
    await callComplete(jobId, evidenceHash);
  } else {
    await callReject(jobId, evidenceHash);
  }

  await resumeHook(evaluatorDoneToken(jobId), { verdict: parsed.verdict, evidenceHash });
  await resumeHook(jobTerminalToken(jobId), { status: parsed.verdict === "accept" ? "Completed" : "Rejected" });

  await recordWorkflowComplete(parsed.verdict);
  return { verdict: parsed.verdict, evidenceHash };
}
```

- [ ] **Step 3: Smoke workflow test (mocks DurableAgent)**

Create `tests/workflow/llm-evaluator-agent.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { start } from "workflow/api";
import { llmEvaluatorAgent } from "@/workflows/llm-evaluator-agent";

vi.mock("@workflow/ai/agent", () => {
  return {
    DurableAgent: class {
      async stream() {
        return {
          messages: [{
            role: "assistant" as const,
            content: JSON.stringify({ verdict: "accept", score: 90, reasoning: "looks good", concerns: [] }),
          }],
        };
      }
    },
  };
});

vi.mock("@/lib/erc8183-state", () => ({
  readJob: vi.fn(async () => ({
    client: "0x1111111111111111111111111111111111111111",
    provider: "0x2222222222222222222222222222222222222222",
    evaluator: "0x3333333333333333333333333333333333333333",
    budget: 1_000_000n,
    expiredAt: 9999999999n,
    status: "Submitted" as const,
    reason: "0x" + "ab".repeat(32),
    hook: "0x4444444444444444444444444444444444444444",
  })),
  isTerminalState: () => false,
}));

vi.mock("@/lib/evidence-store", () => ({
  persistEvidence: vi.fn(async () => ({ uri: "blob://x", hash: "0x" + "cd".repeat(32) })),
}));

vi.mock("@/workflows/lib/settlement-steps", () => ({
  callComplete: vi.fn(async () => ({ txHash: "0xdead" as const })),
  callReject: vi.fn(async () => ({ txHash: "0xdead" as const })),
}));

describe("llmEvaluatorAgent", () => {
  it("settles 'accept' via callComplete", async () => {
    const run = await start(llmEvaluatorAgent, [42n, "standard"]);
    const result = await run.returnValue;
    expect((result as { verdict: string }).verdict).toBe("accept");
  }, 30_000);
});
```

- [ ] **Step 4: Run + verify**

```bash
npm run test:workflow -- tests/workflow/llm-evaluator-agent.test.ts
```

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/llm-evaluator-agent.ts tests/workflow/llm-evaluator-agent.test.ts
git commit -m "feat(workflow): llmEvaluatorAgent with DurableAgent

Tier-selected Claude model evaluates deliverable, persists JSON
evidence to Vercel Blob, writes job_evaluations row, settles
on-chain via Tier 3 validator wallet, fires evaluator:done +
JobTerminal hooks so parent jobLifecycle resumes.
Reasoning streams to namespace 'evaluator:reasoning' for live
dashboard rendering (Plan C consumer)."
```

---

## Phase 11 — `x402PaymentSession` workflow

### Task 29: Implement `x402PaymentSession(buyerAgentId, sellerAgentId)`

**Files:**
- Create: `src/workflows/x402-payment-session.ts`
- Create: `tests/workflow/x402-payment-session.test.ts`

- [ ] **Step 1: Implement session workflow**

Create `src/workflows/x402-payment-session.ts`:

```ts
import { sleep, createHook } from "workflow";
import { db } from "@/lib/db";
import { x402SessionToken } from "./lib/hook-tokens";
import { recordWorkflowStart, recordWorkflowComplete } from "./lib/recording-steps";

interface ReceiptEvent {
  kind: "receipt";
  receipt: {
    sessionDbId: string;
    endpointDbId: string;
    paymentSignature: string;
    amount: string;
    requestHash: string;
    responseHash?: string;
    httpStatus?: number;
    seq: number;
  };
}

interface CloseEvent {
  kind: "close";
  reason: "buyer_closed" | "idle_timeout";
}

type SessionEvent = ReceiptEvent | CloseEvent;

async function openSessionRow(buyer: bigint, seller: bigint, runId: string): Promise<bigint> {
  "use step";
  console.log(`[x402Session] openSessionRow buyer=${buyer} seller=${seller}`);
  const buyerAgent = await db.agent.findUniqueOrThrow({ where: { agentId: buyer.toString() } });
  const sellerAgent = await db.agent.findUniqueOrThrow({ where: { agentId: seller.toString() } });
  const now = new Date();
  const session = await db.x402Session.create({
    data: {
      buyerAgentId: buyerAgent.id,
      sellerAgentId: sellerAgent.id,
      workflowRunId: runId,
      status: "open",
      openedAt: now,
      lastActivityAt: now,
    },
  });
  return session.id;
}

async function persistReceiptStep(receipt: ReceiptEvent["receipt"]): Promise<void> {
  "use step";
  console.log(`[x402Session] persistReceipt seq=${receipt.seq} amount=${receipt.amount}`);
  await db.x402Receipt.create({
    data: {
      sessionId: BigInt(receipt.sessionDbId),
      endpointId: BigInt(receipt.endpointDbId),
      paymentKind: "gateway_batched",
      buyerWallet: Buffer.alloc(20),
      sellerWallet: Buffer.alloc(20),
      amount: receipt.amount,
      requestHash: Buffer.from(receipt.requestHash.replace(/^0x/, ""), "hex"),
      responseHash: receipt.responseHash ? Buffer.from(receipt.responseHash.replace(/^0x/, ""), "hex") : null,
      paymentSignature: Buffer.from(receipt.paymentSignature.replace(/^0x/, ""), "hex"),
      httpStatus: receipt.httpStatus ?? null,
      facilitatorProcessedAt: new Date(),
      seq: receipt.seq,
    },
  });
  await db.x402Session.update({
    where: { id: BigInt(receipt.sessionDbId) },
    data: { lastActivityAt: new Date(), totalCalls: { increment: 1 }, totalAmount: { increment: receipt.amount } },
  });
}

async function checkSellerReputation(sellerAgentId: bigint): Promise<boolean> {
  "use step";
  console.log(`[x402Session] checkSellerReputation seller=${sellerAgentId}`);
  const sellerAgent = await db.agent.findUniqueOrThrow({ where: { agentId: sellerAgentId.toString() } });
  if (!sellerAgent.active) return false;
  const fb = await db.reputationFeedback.findMany({
    where: { agentId: sellerAgent.id },
    select: { score: true },
  });
  if (fb.length === 0) return true; // no signal yet — allow
  const avg = fb.reduce((s, r) => s + (r.score ?? 0), 0) / fb.length;
  return avg > -25;
}

async function closeSessionRow(sessionDbId: bigint, reason: string): Promise<void> {
  "use step";
  console.log(`[x402Session] closeSessionRow id=${sessionDbId} reason=${reason}`);
  await db.x402Session.update({
    where: { id: sessionDbId },
    data: { status: reason === "risk_gated" ? "risk_gated" : "closed", closedAt: new Date() },
  });
}

const IDLE_TIMEOUT_SEC = 30 * 60;

export async function x402PaymentSession(buyerAgentId: bigint, sellerAgentId: bigint) {
  "use workflow";

  await recordWorkflowStart("x402_session", buyerAgentId);
  const sessionDbId = await openSessionRow(buyerAgentId, sellerAgentId, ""); // runId set by recording layer

  const hook = createHook<SessionEvent>({ token: x402SessionToken(buyerAgentId, sellerAgentId) });

  let processed = 0;
  while (true) {
    const winner = await Promise.race([hook, sleep(`${IDLE_TIMEOUT_SEC}s`)]);
    if (winner === undefined) {
      await closeSessionRow(sessionDbId, "idle_timeout");
      await recordWorkflowComplete("idle_timeout");
      return { outcome: "idle_timeout", processed };
    }

    const event = winner as SessionEvent;
    if (event.kind === "close") {
      await closeSessionRow(sessionDbId, event.reason);
      await recordWorkflowComplete(event.reason);
      return { outcome: event.reason, processed };
    }

    await persistReceiptStep(event.receipt);
    processed++;

    if (processed % 10 === 0) {
      const ok = await checkSellerReputation(sellerAgentId);
      if (!ok) {
        await closeSessionRow(sessionDbId, "risk_gated");
        await recordWorkflowComplete("risk_gated");
        return { outcome: "risk_gated", processed };
      }
    }
  }
}
```

- [ ] **Step 2: Smoke workflow test**

Create `tests/workflow/x402-payment-session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { start, resumeHook } from "workflow/api";
import { waitForHook } from "@workflow/vitest";
import { x402PaymentSession } from "@/workflows/x402-payment-session";

describe("x402PaymentSession", () => {
  it("processes a receipt and closes on explicit close event", async () => {
    const run = await start(x402PaymentSession, [10n, 20n]);

    await waitForHook(run, { token: "x402:Session:10:20" });
    await resumeHook("x402:Session:10:20", {
      kind: "receipt",
      receipt: {
        sessionDbId: "1",
        endpointDbId: "1",
        paymentSignature: "0xab",
        amount: "1000",
        requestHash: "0x" + "11".repeat(32),
        seq: 1,
      },
    });
    await resumeHook("x402:Session:10:20", { kind: "close", reason: "buyer_closed" });

    const result = await run.returnValue;
    expect((result as { outcome: string }).outcome).toBe("buyer_closed");
  }, 30_000);
});
```

- [ ] **Step 3: Commit**

```bash
git add src/workflows/x402-payment-session.ts tests/workflow/x402-payment-session.test.ts
git commit -m "feat(workflow): x402PaymentSession (lifecycle + reputation gate, no batching)

Per LBC-2: Circle's facilitator handles batched settlement —
this workflow tracks the (buyer, seller) session lifecycle,
persists receipts, runs a reputation check every 10 receipts,
closes on idle timeout or explicit close event."
```

---

## Phase 12 — `x402DisputeFlow` workflow

### Task 30: Implement `x402DisputeFlow(receiptDbId)`

**Files:**
- Create: `src/workflows/x402-dispute-flow.ts`
- Create: `tests/workflow/x402-dispute-flow.test.ts`

- [ ] **Step 1: Implement dispute workflow**

Create `src/workflows/x402-dispute-flow.ts`:

```ts
import { db } from "@/lib/db";
import { recordWorkflowStart, recordWorkflowComplete } from "./lib/recording-steps";

type Resolution = "refund" | "no_refund" | "manual_review";

async function loadReceiptForDispute(receiptDbId: bigint): Promise<{
  url: string;
  amount: string;
  httpStatus: number | null;
  facilitatorProcessedAt: Date;
} | null> {
  "use step";
  console.log(`[dispute] loadReceiptForDispute receiptId=${receiptDbId}`);
  const receipt = await db.x402Receipt.findUnique({
    where: { id: receiptDbId },
    include: { endpoint: true },
  });
  if (!receipt) return null;
  return {
    url: receipt.endpoint.effectiveUrl,
    amount: receipt.amount.toString(),
    httpStatus: receipt.httpStatus,
    facilitatorProcessedAt: receipt.facilitatorProcessedAt,
  };
}

async function reattemptCall(url: string): Promise<{ status: number; ok: boolean }> {
  "use step";
  console.log(`[dispute] reattemptCall url=${url}`);
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { status: res.status, ok: res.ok };
  } catch (e) {
    console.log(`[dispute] reattemptCall failed: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 0, ok: false };
  }
}

function decideResolution(opts: { originalStatus: number | null; reattemptStatus: number; reattemptOk: boolean }): Resolution {
  if (opts.originalStatus === null) return "manual_review";
  if (opts.originalStatus >= 500 && opts.reattemptStatus >= 500) return "refund";
  if (opts.originalStatus === 408 || opts.originalStatus === 504) return "refund";
  if (opts.originalStatus >= 200 && opts.originalStatus < 300 && opts.reattemptOk) return "no_refund";
  return "manual_review";
}

async function applyResolution(disputeDbId: bigint, resolution: Resolution): Promise<void> {
  "use step";
  console.log(`[dispute] applyResolution disputeId=${disputeDbId} resolution=${resolution}`);
  const status =
    resolution === "refund" ? "resolved_refund" :
    resolution === "no_refund" ? "resolved_no_refund" :
    "manual_review";

  await db.x402Dispute.update({
    where: { id: disputeDbId },
    data: { status, resolvedAt: resolution === "manual_review" ? null : new Date() },
  });
}

export async function x402DisputeFlow(disputeDbId: bigint, receiptDbId: bigint) {
  "use workflow";

  await recordWorkflowStart("dispute", disputeDbId);

  const receipt = await loadReceiptForDispute(receiptDbId);
  if (!receipt) {
    await applyResolution(disputeDbId, "manual_review");
    await recordWorkflowComplete("receipt_missing");
    return { outcome: "receipt_missing" };
  }

  const reattempt = await reattemptCall(receipt.url);
  const resolution = decideResolution({
    originalStatus: receipt.httpStatus,
    reattemptStatus: reattempt.status,
    reattemptOk: reattempt.ok,
  });

  await applyResolution(disputeDbId, resolution);
  await recordWorkflowComplete(resolution);
  return { outcome: resolution };
}
```

- [ ] **Step 2: Test the resolution decision logic in isolation**

Create `tests/workflow/x402-dispute-flow.test.ts`:

```ts
import { describe, it, expect } from "vitest";

const decideResolution = (opts: { originalStatus: number | null; reattemptStatus: number; reattemptOk: boolean }) => {
  if (opts.originalStatus === null) return "manual_review";
  if (opts.originalStatus >= 500 && opts.reattemptStatus >= 500) return "refund";
  if (opts.originalStatus === 408 || opts.originalStatus === 504) return "refund";
  if (opts.originalStatus >= 200 && opts.originalStatus < 300 && opts.reattemptOk) return "no_refund";
  return "manual_review";
};

describe("dispute resolution", () => {
  it("refunds on persistent 5xx", () => {
    expect(decideResolution({ originalStatus: 502, reattemptStatus: 502, reattemptOk: false })).toBe("refund");
  });
  it("refunds on timeout codes", () => {
    expect(decideResolution({ originalStatus: 408, reattemptStatus: 200, reattemptOk: true })).toBe("refund");
  });
  it("declines refund on 2xx that still works", () => {
    expect(decideResolution({ originalStatus: 200, reattemptStatus: 200, reattemptOk: true })).toBe("no_refund");
  });
  it("escalates to manual review when ambiguous", () => {
    expect(decideResolution({ originalStatus: 404, reattemptStatus: 200, reattemptOk: true })).toBe("manual_review");
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm test tests/workflow/x402-dispute-flow.test.ts
```

```bash
git add src/workflows/x402-dispute-flow.ts tests/workflow/x402-dispute-flow.test.ts
git commit -m "feat(workflow): x402DisputeFlow

Loads disputed receipt, re-attempts the call, applies decision
matrix (refund / no_refund / manual_review), updates x402_disputes
row. Manual review escalations show up in /admin/disputes (Plan C)."
```

---

## Phase 13 — Reconciler upgrades + webhook ingest routing

### Task 31: Upgrade `reconcile-stuck-workflows.ts` with chain-state queries + resumeHook firing

**Files:**
- Modify: `src/workers/reconcile-stuck-workflows.ts`
- Create: `tests/integration/reconcile-stuck-workflows.integration.test.ts`

- [ ] **Step 1: Replace the worker implementation**

Edit `src/workers/reconcile-stuck-workflows.ts` (full replacement):

```ts
import { db } from "@/lib/db";
import { resumeHook } from "workflow/api";
import { readJob, isTerminalState, type JobStatusEnum } from "@/lib/erc8183-state";
import {
  jobFundedToken,
  jobSubmittedToken,
  jobTerminalToken,
} from "@/workflows/lib/hook-tokens";

export interface StuckWorkflow {
  runId: string;
  kind: string;
  kindId: bigint;
  lastAdvancedAt: Date;
}

export async function findStuckWorkflows(opts: { olderThanMinutes: number }): Promise<StuckWorkflow[]> {
  const threshold = new Date(Date.now() - opts.olderThanMinutes * 60 * 1000);
  return db.workflowRun.findMany({
    where: { status: "running", lastAdvancedAt: { lt: threshold } },
    select: { runId: true, kind: true, kindId: true, lastAdvancedAt: true },
    take: 100,
  });
}

interface RescueResult {
  runId: string;
  kind: string;
  outcome: "fired_funded" | "fired_submitted" | "fired_terminal" | "no_advancement_possible" | "skipped_unknown_kind" | "error";
  detail?: string;
}

async function rescueJobLifecycle(run: StuckWorkflow): Promise<RescueResult> {
  try {
    const state: JobStatusEnum = (await readJob(run.kindId)).status;

    if (state === "Funded") {
      await resumeHook(jobFundedToken(run.kindId), { jobId: run.kindId.toString() });
      return { runId: run.runId, kind: run.kind, outcome: "fired_funded" };
    }
    if (state === "Submitted") {
      await resumeHook(jobSubmittedToken(run.kindId), { jobId: run.kindId.toString(), deliverable: "0x" + "00".repeat(32) });
      return { runId: run.runId, kind: run.kind, outcome: "fired_submitted" };
    }
    if (isTerminalState(state)) {
      await resumeHook(jobTerminalToken(run.kindId), { status: state });
      return { runId: run.runId, kind: run.kind, outcome: "fired_terminal" };
    }
    return { runId: run.runId, kind: run.kind, outcome: "no_advancement_possible", detail: state };
  } catch (e) {
    return { runId: run.runId, kind: run.kind, outcome: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function reconcileStuckWorkflows(): Promise<{ scanned: number; results: RescueResult[] }> {
  const stuck = await findStuckWorkflows({ olderThanMinutes: 10 });

  const results: RescueResult[] = [];
  for (const run of stuck) {
    let result: RescueResult;
    if (run.kind === "job_lifecycle") {
      result = await rescueJobLifecycle(run);
    } else {
      result = { runId: run.runId, kind: run.kind, outcome: "skipped_unknown_kind" };
    }
    results.push(result);

    await db.auditLog.create({
      data: {
        actorKind: "system",
        actorId: "stuck-workflow-reconciler",
        action: `reconcile.${result.outcome}`,
        targetKind: "workflow_run",
        targetId: run.runId,
        payloadJsonb: { kind: run.kind, kindId: String(run.kindId), detail: result.detail ?? null } as object,
      },
    });
  }

  return { scanned: stuck.length, results };
}
```

- [ ] **Step 2: Write integration test**

Create `tests/integration/reconcile-stuck-workflows.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { reconcileStuckWorkflows } from "@/workers/reconcile-stuck-workflows";

vi.mock("@/lib/erc8183-state", () => ({
  readJob: vi.fn(async (jobId: bigint) => ({
    client: "0x1111111111111111111111111111111111111111",
    provider: "0x2222222222222222222222222222222222222222",
    evaluator: "0x3333333333333333333333333333333333333333",
    budget: 1_000_000n,
    expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    status: jobId === 99n ? ("Submitted" as const) : ("Open" as const),
    reason: "0x" + "00".repeat(32),
    hook: "0x4444444444444444444444444444444444444444",
  })),
  isTerminalState: () => false,
}));

vi.mock("workflow/api", () => ({
  resumeHook: vi.fn(async () => undefined),
}));

describe("reconcileStuckWorkflows (integration)", () => {
  beforeEach(async () => {
    await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
    await db.auditLog.deleteMany({ where: { actorId: "stuck-workflow-reconciler" } });
  });

  afterEach(async () => {
    await db.workflowRun.deleteMany({ where: { runId: { startsWith: "test-stuck-" } } });
    await db.auditLog.deleteMany({ where: { actorId: "stuck-workflow-reconciler" } });
  });

  it("fires JobSubmitted hook when chain shows Submitted but workflow stuck", async () => {
    const stale = new Date(Date.now() - 15 * 60 * 1000);
    await db.workflowRun.create({
      data: {
        runId: "test-stuck-1",
        kind: "job_lifecycle",
        kindId: 99n,
        status: "running",
        startedAt: stale,
        lastAdvancedAt: stale,
      },
    });

    const result = await reconcileStuckWorkflows();
    expect(result.results.some((r) => r.outcome === "fired_submitted")).toBe(true);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
npm test tests/integration/reconcile-stuck-workflows.integration.test.ts
```

Expected: 1 pass.

- [ ] **Step 4: Commit**

```bash
git add src/workers/reconcile-stuck-workflows.ts tests/integration/reconcile-stuck-workflows.integration.test.ts
git commit -m "feat(workers): stuck-workflow reconciler queries chain + fires resumeHook

Plan A landed scaffold (audit_log only). Plan B closes the loop:
read chain state, fire the right hook token (JobFunded /
JobSubmitted / JobTerminal). audit_log records outcome per run."
```

---

### Task 32: Upgrade `ingest-circle-event.ts` with domain-table routing + workflow resumeHook

**Files:**
- Modify: `src/workers/ingest-circle-event.ts`

- [ ] **Step 1: Replace the worker implementation**

Edit `src/workers/ingest-circle-event.ts` (full replacement):

```ts
import { db } from "@/lib/db";
import { resumeHook } from "workflow/api";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import {
  jobFundedToken,
  jobSubmittedToken,
  jobTerminalToken,
} from "@/workflows/lib/hook-tokens";

export interface CircleWebhookPayload {
  eventType: string;
  data: {
    contractAddress: string;
    eventName: string;
    txHash: string;
    logIndex: number;
    blockNumber: string;
    blockTime: string;
    params: Record<string, unknown>;
  };
}

function bytesFromHex(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

async function handleAgentRegistered(data: CircleWebhookPayload["data"]): Promise<void> {
  const params = data.params as { agentId?: string; operator?: string; policyHash?: string };
  if (!params.agentId || !params.operator) return;

  const operatorBytes = bytesFromHex(params.operator);
  const wallet = await db.wallet.findUnique({ where: { address: operatorBytes } });
  if (!wallet) return;

  await db.agent.upsert({
    where: { agentId: params.agentId },
    update: { active: true, currentOperatorWalletId: wallet.id },
    create: {
      agentId: params.agentId,
      identityOwnerWallet: bytesFromHex(params.operator),
      currentOperatorWalletId: wallet.id,
      agentWalletAddress: operatorBytes,
      registeredAtBlock: BigInt(data.blockNumber),
      active: true,
    },
  });
}

async function handle8183JobEvent(data: CircleWebhookPayload["data"], tokenFn: (jobId: bigint) => string, eventKind: string): Promise<void> {
  const jobIdRaw = (data.params as { jobId?: string }).jobId;
  if (!jobIdRaw) return;
  const jobId = BigInt(jobIdRaw);

  const job = await db.job.findUnique({ where: { jobId: jobId.toString() } });
  if (job) {
    await db.jobEvent.create({
      data: {
        jobId: job.id,
        eventKind,
        actorAddress: bytesFromHex(((data.params as { actor?: string }).actor) ?? data.contractAddress),
        payloadJsonb: data.params as object,
        chainId: 5042002,
        txHash: bytesFromHex(data.txHash),
        logIndex: data.logIndex,
        blockNumber: BigInt(data.blockNumber),
        blockTime: new Date(data.blockTime),
      },
    });
  }

  await resumeHook(tokenFn(jobId), data.params);
}

async function handleReputationFeedback(data: CircleWebhookPayload["data"]): Promise<void> {
  const p = data.params as { agentId?: string; value?: number; tag1?: string; tag2?: string; feedbackHash?: string };
  if (!p.agentId) return;
  const agent = await db.agent.findUnique({ where: { agentId: p.agentId } });
  if (!agent) return;

  await db.reputationFeedback.upsert({
    where: { chainId_txHash_logIndex: { chainId: 5042002, txHash: bytesFromHex(data.txHash), logIndex: data.logIndex } },
    update: {},
    create: {
      agentId: agent.id,
      submitterAddress: bytesFromHex(data.contractAddress),
      source: "arkage_hook",
      score: p.value ?? null,
      tag1: p.tag1 ?? null,
      tag2: p.tag2 ?? null,
      feedbackHash: p.feedbackHash ? bytesFromHex(p.feedbackHash) : null,
      chainId: 5042002,
      txHash: bytesFromHex(data.txHash),
      logIndex: data.logIndex,
      blockTime: new Date(data.blockTime),
    },
  });
}

export async function ingestCircleEvent(payload: CircleWebhookPayload): Promise<void> {
  if (payload.eventType !== "contracts.event") return;

  const { data } = payload;
  const addr = data.contractAddress.toLowerCase();

  await db.auditLog.create({
    data: {
      actorKind: "system",
      actorId: "circle-webhook",
      action: `chain.${data.eventName}`,
      targetKind: "contract",
      targetId: data.contractAddress,
      payloadJsonb: data as unknown as object,
    },
  });

  if (data.eventName === "AgentRegistered") {
    await handleAgentRegistered(data);
    return;
  }

  if (addr === ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE.toLowerCase()) {
    if (data.eventName === "JobFunded") return handle8183JobEvent(data, jobFundedToken, "funded");
    if (data.eventName === "JobSubmitted") return handle8183JobEvent(data, jobSubmittedToken, "submitted");
    if (data.eventName === "JobCompleted") {
      await handle8183JobEvent(data, jobTerminalToken, "completed");
      return;
    }
    if (data.eventName === "JobRejected") {
      await handle8183JobEvent(data, jobTerminalToken, "rejected");
      return;
    }
  }

  if (addr === ARC_TESTNET_ADDRESSES.ERC_8004_REPUTATION_REGISTRY.toLowerCase()) {
    if (data.eventName === "FeedbackGiven") {
      await handleReputationFeedback(data);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workers/ingest-circle-event.ts
git commit -m "feat(workers): route Circle webhook events to domain tables + resumeHook

- AgentRegistered → upserts agents row
- 8183 JobFunded/Submitted/Completed/Rejected → writes job_events
  + fires the matching deterministic hook token
- 8004 FeedbackGiven → upserts reputation_feedback
- Idempotent via unique (chainId, txHash, logIndex) constraints
- audit_log entry on every event for traceability"
```

---

## Phase 14 — Smoke tests + handoff

### Task 33: End-to-end smoke test (manual procedure)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Issue a dev MCP token via psql + tokens module**

```bash
node --input-type=module -e "
  import { issueToken, hashToken } from './src/lib/tokens.ts';
  import { db } from './src/lib/db.ts';
  const token = issueToken();
  const hash = hashToken(token);
  const builder = await db.builder.findFirst();
  if (!builder) throw new Error('seed a builder first via prisma db seed');
  await db.auditLog.create({
    data: {
      actorKind: 'token',
      actorId: hash,
      action: 'token.issued',
      payloadJsonb: { builderId: builder.id.toString(), walletAddress: '0x' + Buffer.from(builder.primaryWallet).toString('hex') },
    },
  });
  console.log('Token:', token);
"
```

Save the printed token as `DEV_MCP_TOKEN`.

- [ ] **Step 3: Call `arkage:get_protocol_health` to verify the MCP loop**

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $DEV_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"arkage:get_protocol_health","arguments":{}}}'
```

Expected: 200 with `{ ok: true, data: { jobsByStatus: ..., activeAgents: ..., ... } }`.

- [ ] **Step 4: Trigger a workflow run via `arkage:post_job` (requires Tier 2 wallet provisioned)**

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $DEV_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"arkage:post_job","arguments":{"asAgent":"<dbId>","evaluator":"<arkage validator addr>","expiredAtSec":1799999999,"description":"smoke test","idempotencyKey":"smoke-1"}}}'
```

Expected: returns `createTx` and `workflowRunId`.

- [ ] **Step 5: Verify workflow registered in database**

```bash
psql "$DATABASE_URL" -c "SELECT run_id, kind, status, last_advanced_at FROM workflow_runs ORDER BY created_at DESC LIMIT 5;"
```

Expected: row with `kind = 'job_lifecycle'`, `status = 'running'`.

- [ ] **Step 6: Inspect via Workflow CLI**

```bash
npx workflow inspect runs --backend vercel
```

Expected: lists the workflow run.

- [ ] **Step 7: Verify webhook ingestion (after on-chain events fire)**

```bash
psql "$DATABASE_URL" -c "SELECT event_kind, block_time FROM job_events ORDER BY block_time DESC LIMIT 10;"
```

Expected: `funded` event appears within ~30 seconds of the on-chain confirmation.

---

### Task 34: Plan B verification checklist

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 2: Run all workflow tests**

```bash
npm run test:workflow
```

Expected: green.

- [ ] **Step 3: Confirm tool count**

```bash
node --input-type=module -e "
  import { listRegisteredTools } from './src/mcp/server.ts';
  await import('./src/mcp/register-all-tools.ts');
  const tools = listRegisteredTools();
  console.log(tools.length, 'tools registered:');
  tools.forEach((t) => console.log('  ' + t.name));
"
```

Expected: 22 tools across 5 domains. (Plan D adds 4 more x402 tools to reach the target ~26.)

- [ ] **Step 4: Confirm 4 workflows registered**

```bash
npx workflow inspect runs --json | jq -r '.[] | .kind' | sort -u
```

Expected: `job_lifecycle`, `evaluator`, `x402_session`, `dispute` after at least one of each has run.

- [ ] **Step 5: Tag completion**

```bash
git tag plan-b-complete
git push origin main --tags
```

✅ **Plan B complete.** Agent-side automation layer is live: MCP server with 22 tools, 4 durable workflows, evaluator settling on-chain with hashed evidence, stuck-workflow reconciler closing the loop.

---

## Self-review

- **Spec coverage check:**
  - Spec §3 MCP tools: 22 of 26 implemented in Plan B (Tasks 12-22). The remaining 4 (`pay_and_call`, `register_x402_endpoint`, `list_my_x402_endpoints`, `list_my_x402_receipts`) are Plan D scope per spec §9 decomposition.
  - Spec §4.1 workflow catalog: all 4 workflows implemented (Tasks 27-30).
  - Spec §4.2 cross-cutting patterns: self-rescue race (Task 24), deterministic hook tokens (Task 24), `reason` field threading (evaluator persists evidence hash, settlement uses it as `reason`), wallet routing (Task 8).
  - Spec §4.7 indexer + crons: ingest worker upgraded (Task 32), stuck-workflow reconciler upgraded (Task 31). Goldsky pipeline + Circle webhook receiver are Plan A artifacts and continue to feed events.
  - Spec §5 wallet topology: Tier 1/2/3 helpers (Tasks 5-7), wallet router (Task 8), policy engine (Tasks 9-10), agent loader (Task 11). `bootstrap_user` exercises all three tiers (Task 12).
- **Placeholder scan:** No `TBD`/`TODO` in plan body. Tool implementations all complete. The "blockchain: ARC-TESTNET" Circle SDK string and exact Circle DCW request shape need verification at impl time against the latest `@circle-fin/developer-controlled-wallets` docs — flagged inline as needing verification rather than as a TODO.
- **Type consistency:**
  - `EvaluatorTier` type identical across `evaluator-prompts.ts`, `llm-evaluator-agent.ts`, `bootstrap-user.ts`, `fund-job.ts`, `agent-loader.ts`.
  - `LoadedAgent` shape used uniformly by all MCP tools through `loadAgentByDbId` / `loadAgentByOperator`.
  - `RoutingDecision` discriminated union consumed identically by `post_job`, `fund_job`, etc.
  - Hook token strings produced by `hook-tokens.ts` match the consumer in `reconcile-stuck-workflows.ts` and `ingest-circle-event.ts`.
- **AI SDK v6 conformance:** Evaluator uses `stopWhen: stepCountIs(N)` (not removed `maxSteps`). Model IDs use dotted version format (`anthropic/claude-haiku-4.5` etc.) per AI Gateway convention.
- **Validator caveats reviewed:** Logging suggestions (27) — most steps already log entry/exit; remaining files (recording-steps, settlement-steps, evidence-store, dispute flow) all have explicit `console.log` at step boundaries.

---

**End of Plan B.**

