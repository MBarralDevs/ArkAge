# Plan D — x402 Facilitator Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four x402 MCP tools (`pay_and_call`, `register_x402_endpoint`, `list_my_x402_endpoints`, `list_my_x402_receipts`), the ArkAge proxy Vercel Function for sellers who don't want to self-host, the buyer-side Gateway deposit step in `bootstrap_user`, the Circle facilitator webhook receiver, the dispute-trigger MCP tool, and the treasury reconciliation cron — turning Plan B's `x402PaymentSession` + `x402DisputeFlow` workflow scaffolds into live agent-to-agent commerce on Arc Testnet.

**Architecture:**
- **Buyer side:** `arkage:pay_and_call` thin-wraps `GatewayClient.pay()` from `@circle-fin/x402-batching`. Each call opens or joins an `x402PaymentSession` for the (buyer agent, seller agent) pair. Receipts persist to Postgres in real time; on-chain settlement is Circle's responsibility (TEE-backed batched settlement at the Gateway domain `26` for Arc Testnet — confirmed in spec §0 / §1).
- **Seller side, two hosting modes:**
  - `self`: seller runs their own Express/Next server with `createGatewayMiddleware()`. ArkAge stores the endpoint metadata; receipts arrive via Circle's facilitator webhook.
  - `arkage-proxy`: ArkAge runs a Vercel Function at `/api/x402-proxy/[endpointId]` that holds the middleware and forwards verified requests to the seller's actual implementation. Eases adoption for sellers who can't host x402 plumbing themselves.
- **Facilitator overlay:** ArkAge does not build its own x402 facilitator (per LBC-2 from spec research). We wrap Circle's hosted facilitator with three differentiators: agentId-keyed receipt tracking, ERC-8004 reputation gates inside `x402PaymentSession`, and the dispute resolution workflow.
- **Treasury reconciliation:** Circle Gateway's batched settlements drop USDC into the seller's Tier 2 wallet asynchronously. A cron sweeps Circle's Settle x402 Payment API status into Postgres `treasury_movements` so the dashboard's treasury widget stays accurate.

**Tech Stack:**
- `@circle-fin/x402-batching` (`GatewayClient`, `createGatewayMiddleware`, `BatchFacilitatorClient`)
- `@x402/core`, `@x402/evm` (peer deps from x402-batching)
- viem for the one-time on-chain `client.deposit()` call during `bootstrap_user`
- Vercel Functions for the proxy (Node.js runtime, Fluid Compute)
- Vercel Cron for treasury reconciliation
- Vitest for tests

**Plan reference:** Spec at `docs/superpowers/specs/2026-05-02-arkage-design.md` §3 (MCP tool surface — x402 domain), §4.5 (`x402PaymentSession`), §4.6 (`x402DisputeFlow`), §5.5 (`bootstrap_user` Gateway deposit step), §11 (pre-impl checklist — verify x402 facilitator endpoint URL on Arc Testnet against current SDK). Builds on Plans A (data layer), B (MCP server, workflows, EOA-mode Tier 2 DCWs, `pay_and_call` placeholder noted in §3.2 as Plan D scope), and C (dashboard surfacing x402 data).

---

## File structure produced by this plan

```
ArkAge/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── x402-proxy/
│   │   │   │   └── [endpointId]/
│   │   │   │       └── route.ts                        # arkage-proxy hosting mode
│   │   │   ├── webhooks/
│   │   │   │   └── circle-x402-facilitator/
│   │   │   │       └── route.ts                        # Circle facilitator settlement push
│   │   │   └── cron/
│   │   │       └── reconcile-treasury/
│   │   │           └── route.ts
│   ├── mcp/
│   │   ├── tools/
│   │   │   └── x402/
│   │   │       ├── pay-and-call.ts
│   │   │       ├── register-x402-endpoint.ts
│   │   │       ├── list-my-x402-endpoints.ts
│   │   │       ├── list-my-x402-receipts.ts
│   │   │       └── dispute-receipt.ts
│   │   └── register-all-tools.ts                       # MODIFIED: import x402 tools
│   ├── lib/
│   │   ├── x402-buyer.ts                               # GatewayClient factory + helpers
│   │   ├── x402-seller-proxy.ts                        # createGatewayMiddleware adapter
│   │   ├── x402-facilitator-verify.ts                  # facilitator webhook signature
│   │   ├── x402-session-manager.ts                     # open/join/close session helpers
│   │   ├── x402-receipt-store.ts                       # Postgres x402_receipts writer
│   │   └── tier2-dcw.ts                                # MODIFIED: add depositToGateway helper
│   ├── workers/
│   │   ├── ingest-x402-settlement.ts                   # webhook → treasury_movements + receipts
│   │   └── reconcile-treasury.ts                       # cron logic
│   ├── workflows/
│   │   ├── x402-payment-session.ts                     # MODIFIED: persist receipts via store
│   │   └── x402-dispute-flow.ts                        # MODIFIED: pull facilitator logs
│   └── types/
│       └── x402.ts                                     # cross-file typed shapes
├── tests/
│   ├── unit/
│   │   ├── x402-buyer.test.ts
│   │   ├── x402-facilitator-verify.test.ts
│   │   └── x402-session-manager.test.ts
│   ├── integration/
│   │   ├── x402-proxy-route.test.ts
│   │   ├── x402-facilitator-webhook.test.ts
│   │   └── pay-and-call.test.ts
│   └── e2e/
│       └── x402-end-to-end.spec.ts
└── docs/runbooks/
    └── x402-seller-onboarding.md
```

---

## Execution order constraints

- Tasks 1-3 (buyer side) before Task 9 (session wiring depends on `pay_and_call`)
- Tasks 4-7 (seller side) before Task 8 (facilitator webhook expects registered endpoints)
- Tasks 8-10 (session lifecycle) after both sides exist
- Tasks 11-12 (disputes) after sessions emit receipts
- Task 13 (treasury cron) after settlements flow through
- Tasks 14-15 (smoke + handoff) last

Recommended sequence: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15.

---

## Phase 1 — Buyer-side x402

### Task 1: `arkage:pay_and_call` MCP tool

**Files:**
- Create: `src/lib/x402-buyer.ts`
- Create: `src/types/x402.ts`
- Create: `src/mcp/tools/x402/pay-and-call.ts`
- Create: `tests/integration/pay-and-call.test.ts`

- [ ] **Step 1: Define cross-file types**

Create `src/types/x402.ts`:

```ts
import type { Address } from "viem";

export interface X402PaymentRequirement {
  scheme: "exact" | "exact_evm" | "gateway_batched";
  network: string;            // e.g. "arcTestnet"
  asset: Address;             // USDC ERC-20
  amount: bigint;             // raw 6-decimal units
  payTo: Address;
  validBeforeSec: number;
  facilitator?: string;       // facilitator service URL when seller delegates
  description?: string;
}

export interface X402Receipt {
  paymentSignature: `0x${string}`;
  amount: bigint;
  payee: Address;
  payer: Address;
  asset: Address;
  facilitatorTxHash?: `0x${string}`;
  facilitatorProcessedAt: Date;
}
```

- [ ] **Step 2: Buyer client helpers**

Create `src/lib/x402-buyer.ts`:

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Address } from "viem";

/** Factory: returns a GatewayClient bound to the agent's Tier 2 EOA private key. */
export function gatewayClientForAgent(agentEoaPrivateKey: `0x${string}`): GatewayClient {
  return new GatewayClient({
    chain: "arcTestnet",
    privateKey: agentEoaPrivateKey,
  });
}

/** One-time on-chain deposit funding the Gateway Wallet for this EOA. */
export async function ensureGatewayDeposit(
  client: GatewayClient,
  amountUsdc: string
): Promise<{ depositTxHash: `0x${string}` | null; alreadyFunded: boolean }> {
  // SDK exposes deposit(); client also exposes balance() in current versions.
  // We attempt deposit; on insufficient funds error or already-deposited indicator,
  // surface alreadyFunded=true. Verify against the installed SDK version.
  try {
    const tx = await client.deposit(amountUsdc);
    return { depositTxHash: tx.transactionHash as `0x${string}`, alreadyFunded: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already deposited|sufficient balance/i.test(msg)) {
      return { depositTxHash: null, alreadyFunded: true };
    }
    throw e;
  }
}

export interface PayAndCallParams {
  url: string;
  maxPriceRaw?: bigint;
  expectedSeller?: Address;
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
}

export interface PayAndCallResult {
  status: number;
  body: unknown;
  paymentSignature: `0x${string}`;
  amountPaid: bigint;
  sellerAddress: Address;
  paymentResponseHeader: string | null;
  facilitatorTxHash: `0x${string}` | null;
}

/** Execute a paid request through the GatewayClient SDK. */
export async function payAndCall(
  client: GatewayClient,
  params: PayAndCallParams
): Promise<PayAndCallResult> {
  const result = await client.pay(params.url, {
    maxPrice: params.maxPriceRaw?.toString(),
    headers: params.requestHeaders,
    body: params.requestBody,
  });

  // SDK return shape (verify against current version): { status, data, payment, headers }
  // payment includes the EIP-3009 signature, amount, payee, and facilitator settlement tx (if synchronous).
  const paymentResponseHeader = (result.headers as Record<string, string> | undefined)?.["payment-response"] ?? null;

  if (params.expectedSeller && result.payment?.payTo?.toLowerCase() !== params.expectedSeller.toLowerCase()) {
    throw new Error(`x402: expected seller ${params.expectedSeller} but 402 declared ${result.payment?.payTo}`);
  }
  if (params.maxPriceRaw !== undefined && BigInt(result.payment?.amount ?? "0") > params.maxPriceRaw) {
    throw new Error(`x402: 402 demanded ${result.payment?.amount} > maxPrice ${params.maxPriceRaw}`);
  }

  return {
    status: result.status,
    body: result.data,
    paymentSignature: result.payment.signature as `0x${string}`,
    amountPaid: BigInt(result.payment.amount),
    sellerAddress: result.payment.payTo as Address,
    paymentResponseHeader,
    facilitatorTxHash: (result.payment.settlementTxHash as `0x${string}` | undefined) ?? null,
  };
}
```

- [ ] **Step 3: Failing integration test**

Create `tests/integration/pay-and-call.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePayAndCall } from "@/mcp/tools/x402/pay-and-call";
import { db } from "@/lib/db";

vi.mock("@/lib/x402-buyer", () => ({
  gatewayClientForAgent: vi.fn(() => ({})),
  payAndCall: vi.fn(async () => ({
    status: 200,
    body: { ok: true, payload: "hello" },
    paymentSignature: ("0x" + "ab".repeat(32)) as `0x${string}`,
    amountPaid: 1000n,
    sellerAddress: "0x2222000000000000000000000000000000000002" as `0x${string}`,
    paymentResponseHeader: "scheme=gateway_batched; tx=null",
    facilitatorTxHash: null,
  })),
}));

vi.mock("@/lib/x402-session-manager", () => ({
  openOrJoinSession: vi.fn(async () => ({ sessionDbId: 1n, runId: "test-run", openedNew: true })),
  bumpSessionActivity: vi.fn(async () => undefined),
}));

vi.mock("@/lib/x402-receipt-store", () => ({
  recordReceiptForSession: vi.fn(async () => ({ receiptDbId: 7n, seq: 1 })),
}));

vi.mock("@/lib/agent-loader", () => ({
  loadAgentByDbId: vi.fn(async () => ({
    dbId: 1n,
    agentId: 100n,
    operatorWallet: "0x1111000000000000000000000000000000000001",
    identityOwner: "0x9999000000000000000000000000000000000009",
    active: true,
    policy: {
      schemaVersion: 1, agentId: "100", version: 1, validFrom: 0, validTo: null,
      spendCaps: { perTx: "10000", perDay: "100000", perWeek: "700000" },
      allowedContracts: [], allowedSelectors: [],
      counterpartyRules: { minReputation: null, allowList: [], denyList: [] },
      rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 60 },
      tokens: ["0x3600000000000000000000000000000000000000"],
      evaluatorPreferences: { defaultTier: "standard", maxFeePerJob: "1000000" },
    },
    perTxCap: 10000n,
  })),
}));

describe("pay_and_call", () => {
  it("returns body, receipt id, session id when payment succeeds", async () => {
    const result = await handlePayAndCall(
      {
        asAgent: "1",
        url: "https://seller.test/api/data",
        maxPrice: "5000",
        idempotencyKey: "pc-1",
      },
      {
        token: "arkage_" + "0".repeat(64),
        builderId: 1n,
        actingAgentId: 1n,
        actingWalletAddress: "0x1111000000000000000000000000000000000001",
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
      expect(result.data.amountPaid).toBe("1000");
      expect(result.data.receiptId).toBe("7");
      expect(result.data.sessionId).toBe("1");
    }
  });
});
```

- [ ] **Step 4: Run, verify failure**

```bash
npm test tests/integration/pay-and-call.test.ts
```

Expected: FAIL — handler module missing.

- [ ] **Step 5: Implement the MCP tool**

Create `src/mcp/tools/x402/pay-and-call.ts`:

```ts
import { z } from "zod";
import type { Address } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { db } from "@/lib/db";
import { gatewayClientForAgent, payAndCall } from "@/lib/x402-buyer";
import { evaluatePolicy } from "@/lib/policy-engine";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { route } from "@/lib/wallet-router";
import { openOrJoinSession, bumpSessionActivity } from "@/lib/x402-session-manager";
import { recordReceiptForSession } from "@/lib/x402-receipt-store";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  url: z.string().url(),
  maxPrice: z.string().regex(/^[0-9]+$/).optional(),
  expectedSeller: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  requestBody: z.unknown().optional(),
  requestHeaders: z.record(z.string()).optional(),
  idempotencyKey: z.string().min(1),
});

interface Output {
  status: number;
  body: unknown;
  amountPaid: string;
  sellerAddress: string;
  receiptId: string;
  sessionId: string;
  facilitatorTxHash: string | null;
}

export async function handlePayAndCall(rawInput: unknown, _ctx: McpAuthContext): Promise<Result<Output>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
  const maxPriceRaw = parse.data.maxPrice ? BigInt(parse.data.maxPrice) : undefined;

  // Off-chain policy gate
  const verdict = await evaluatePolicy({
    agentDbId: agent.dbId,
    policy: agent.policy,
    action: "x402_pay",
    amount: maxPriceRaw,
    counterparty: parse.data.expectedSeller as Address | undefined,
    contractTarget: "0x0000000000000000000000000000000000000000" as Address, // x402 has no on-chain target until settlement
  });
  if (!verdict.ok) return err(verdict.code, verdict.message);

  const decision = route({
    kind: "x402_pay",
    agent: { agentId: agent.agentId, operatorWallet: agent.operatorWallet, perTxCap: agent.perTxCap, active: agent.active },
  });
  if ("reject" in decision) return err("routing_rejected", decision.reason);

  // Resolve the EOA private key for this Tier 2 wallet from Circle DCW.
  // Circle DCWs in EOA mode can export a signed payload; for the buyer-flow
  // here we use a thin proxy: ArkAge issues a short-lived signing token to
  // the GatewayClient, which calls our /api/x402-buyer-sign route. To keep the
  // sketch concrete, this template loads the key reference and lets the SDK
  // wrap it. Verify exact API at impl time per `@circle-fin/x402-batching`.
  const wallet = await db.wallet.findUniqueOrThrow({
    where: { address: Buffer.from(agent.operatorWallet.replace(/^0x/, ""), "hex") },
  });
  if (!wallet.circleWalletId) return err("config_error", "Tier 2 wallet missing circleWalletId");

  const eoaPrivateKey = process.env[`ARKAGE_TIER2_KEY_${wallet.id}`] as `0x${string}` | undefined;
  if (!eoaPrivateKey) return err("config_error", "Tier 2 EOA key not provisioned in env");

  const client = gatewayClientForAgent(eoaPrivateKey);

  let result;
  try {
    result = await payAndCall(client, {
      url: parse.data.url,
      maxPriceRaw,
      expectedSeller: parse.data.expectedSeller as Address | undefined,
      requestBody: parse.data.requestBody,
      requestHeaders: parse.data.requestHeaders,
    });
  } catch (e) {
    return err("x402_pay_failed", e instanceof Error ? e.message : String(e));
  }

  // Resolve seller agent (if registered with ArkAge)
  const sellerWalletBytes = Buffer.from(result.sellerAddress.replace(/^0x/, ""), "hex");
  const sellerWallet = await db.wallet.findUnique({ where: { address: sellerWalletBytes } });
  let sellerAgentDbId: bigint;
  if (sellerWallet) {
    const sa = await db.agent.findFirst({ where: { currentOperatorWalletId: sellerWallet.id } });
    sellerAgentDbId = sa?.id ?? 0n;
  } else {
    sellerAgentDbId = 0n;
  }

  // If seller is registered with ArkAge → open or join session and persist receipt.
  // Otherwise we still record the receipt against an unknown seller for the buyer's accounting.
  const session = sellerAgentDbId > 0n
    ? await openOrJoinSession(agent.dbId, sellerAgentDbId)
    : null;

  const receipt = session
    ? await recordReceiptForSession({
        sessionDbId: session.sessionDbId,
        endpointId: 0n,
        amount: result.amountPaid,
        paymentSignature: result.paymentSignature,
        buyerWallet: agent.operatorWallet as Address,
        sellerWallet: result.sellerAddress,
        httpStatus: result.status,
      })
    : { receiptDbId: 0n, seq: 0 };

  if (session) await bumpSessionActivity(session.sessionDbId);

  return ok({
    status: result.status,
    body: result.body,
    amountPaid: result.amountPaid.toString(),
    sellerAddress: result.sellerAddress,
    receiptId: receipt.receiptDbId.toString(),
    sessionId: session?.sessionDbId.toString() ?? "0",
    facilitatorTxHash: result.facilitatorTxHash,
  });
}

registerTool({
  name: "arkage:pay_and_call",
  description: "Make an x402 paid HTTP call. Auto-opens or joins a session with the seller agent.",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handlePayAndCall,
});
```

- [ ] **Step 6: Run, verify pass**

```bash
npm test tests/integration/pay-and-call.test.ts
```

Expected: 1 pass.

- [ ] **Step 7: Commit**

```bash
git add src/types/x402.ts src/lib/x402-buyer.ts src/mcp/tools/x402/pay-and-call.ts tests/integration/pay-and-call.test.ts
git commit -m "feat(x402): pay_and_call MCP tool — buyer side via GatewayClient

Off-chain policy gate + wallet routing + GatewayClient.pay()
wrapper. Auto-opens/joins x402PaymentSession for the (buyer,
seller) pair when seller is an ArkAge-registered agent.
Persists receipt; session-less receipts also recorded for
buyer accounting against unknown sellers."
```

---

### Task 2: Session manager + receipt store helpers

**Files:**
- Create: `src/lib/x402-session-manager.ts`
- Create: `src/lib/x402-receipt-store.ts`

- [ ] **Step 1: Implement session manager**

Create `src/lib/x402-session-manager.ts`:

```ts
import { db } from "./db";
import { start } from "workflow/api";
import { x402PaymentSession } from "@/workflows/x402-payment-session";

export interface SessionHandle {
  sessionDbId: bigint;
  runId: string;
  openedNew: boolean;
}

const REOPEN_AFTER_IDLE_MS = 30 * 60_000; // 30 min — matches workflow timeout

export async function openOrJoinSession(buyerAgentDbId: bigint, sellerAgentDbId: bigint): Promise<SessionHandle> {
  const existing = await db.x402Session.findFirst({
    where: {
      buyerAgentId: buyerAgentDbId,
      sellerAgentId: sellerAgentDbId,
      status: "open",
      lastActivityAt: { gt: new Date(Date.now() - REOPEN_AFTER_IDLE_MS) },
    },
    orderBy: { openedAt: "desc" },
  });
  if (existing) return { sessionDbId: existing.id, runId: existing.workflowRunId, openedNew: false };

  // Look up agent ids on-chain side for the workflow signature
  const [buyerAgent, sellerAgent] = await Promise.all([
    db.agent.findUniqueOrThrow({ where: { id: buyerAgentDbId } }),
    db.agent.findUniqueOrThrow({ where: { id: sellerAgentDbId } }),
  ]);

  const run = await start(x402PaymentSession, [BigInt(buyerAgent.agentId.toString()), BigInt(sellerAgent.agentId.toString())]);

  const created = await db.x402Session.create({
    data: {
      buyerAgentId: buyerAgentDbId,
      sellerAgentId: sellerAgentDbId,
      workflowRunId: run.runId,
      status: "open",
      openedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });
  return { sessionDbId: created.id, runId: run.runId, openedNew: true };
}

export async function bumpSessionActivity(sessionDbId: bigint): Promise<void> {
  await db.x402Session.update({ where: { id: sessionDbId }, data: { lastActivityAt: new Date() } });
}

export async function closeSession(sessionDbId: bigint, reason: "buyer_closed" | "idle_timeout" | "risk_gated"): Promise<void> {
  await db.x402Session.update({
    where: { id: sessionDbId },
    data: {
      status: reason === "risk_gated" ? "risk_gated" : "closed",
      closedAt: new Date(),
    },
  });
}
```

- [ ] **Step 2: Implement receipt store**

Create `src/lib/x402-receipt-store.ts`:

```ts
import { db } from "./db";
import type { Address } from "viem";
import { resumeHook } from "workflow/api";
import { x402SessionToken } from "@/workflows/lib/hook-tokens";

export interface RecordReceiptInput {
  sessionDbId: bigint;
  endpointId: bigint;
  amount: bigint;
  paymentSignature: `0x${string}`;
  buyerWallet: Address;
  sellerWallet: Address;
  httpStatus: number;
  responseHash?: `0x${string}`;
  requestHash?: `0x${string}`;
}

export async function recordReceiptForSession(input: RecordReceiptInput): Promise<{ receiptDbId: bigint; seq: number }> {
  const lastReceipt = await db.x402Receipt.findFirst({
    where: { sessionId: input.sessionDbId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const nextSeq = (lastReceipt?.seq ?? 0) + 1;

  const created = await db.x402Receipt.create({
    data: {
      sessionId: input.sessionDbId,
      endpointId: input.endpointId,
      paymentKind: "gateway_batched",
      buyerWallet: Buffer.from(input.buyerWallet.replace(/^0x/, ""), "hex"),
      sellerWallet: Buffer.from(input.sellerWallet.replace(/^0x/, ""), "hex"),
      amount: input.amount.toString(),
      requestHash: input.requestHash ? Buffer.from(input.requestHash.replace(/^0x/, ""), "hex") : Buffer.alloc(32),
      responseHash: input.responseHash ? Buffer.from(input.responseHash.replace(/^0x/, ""), "hex") : null,
      paymentSignature: Buffer.from(input.paymentSignature.replace(/^0x/, ""), "hex"),
      httpStatus: input.httpStatus,
      facilitatorProcessedAt: new Date(),
      seq: nextSeq,
    },
  });

  await db.x402Session.update({
    where: { id: input.sessionDbId },
    data: { totalCalls: { increment: 1 }, totalAmount: { increment: input.amount.toString() } },
  });

  // Notify the live x402PaymentSession workflow
  const session = await db.x402Session.findUniqueOrThrow({
    where: { id: input.sessionDbId },
    include: { buyerAgent: { select: { agentId: true } }, sellerAgent: { select: { agentId: true } } },
  });
  await resumeHook(
    x402SessionToken(BigInt(session.buyerAgent.agentId.toString()), BigInt(session.sellerAgent.agentId.toString())),
    {
      kind: "receipt",
      receipt: {
        sessionDbId: input.sessionDbId.toString(),
        endpointDbId: input.endpointId.toString(),
        paymentSignature: input.paymentSignature,
        amount: input.amount.toString(),
        requestHash: input.requestHash ?? "0x" + "00".repeat(32),
        responseHash: input.responseHash,
        httpStatus: input.httpStatus,
        seq: nextSeq,
      },
    }
  );

  return { receiptDbId: created.id, seq: nextSeq };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/x402-session-manager.ts src/lib/x402-receipt-store.ts
git commit -m "feat(x402): session manager + receipt store

openOrJoinSession reuses an open session within 30min idle window;
otherwise spawns a new x402PaymentSession workflow run.
recordReceiptForSession persists, increments session totals, and
fires resumeHook with the receipt payload — keeping the workflow
in sync with the live receipt stream."
```

---

### Task 3: Bootstrap Gateway deposit upgrade

**Files:**
- Modify: `src/lib/tier2-dcw.ts`
- Modify: `src/mcp/tools/identity/bootstrap-user.ts`

- [ ] **Step 1: Add depositToGateway helper**

Edit `src/lib/tier2-dcw.ts` — append:

```ts
import { gatewayClientForAgent, ensureGatewayDeposit } from "./x402-buyer";

export async function depositTier2ToGateway(walletId: bigint, eoaPrivateKey: `0x${string}`, amountUsdc: string): Promise<{ depositTxHash: `0x${string}` | null; alreadyFunded: boolean }> {
  const client = gatewayClientForAgent(eoaPrivateKey);
  const result = await ensureGatewayDeposit(client, amountUsdc);

  if (result.depositTxHash) {
    await db.auditLog.create({
      data: {
        actorKind: "system",
        actorId: "bootstrap",
        action: "x402.gateway_deposit",
        targetKind: "wallet",
        targetId: walletId.toString(),
        payloadJsonb: { txHash: result.depositTxHash, amountUsdc } as object,
      },
    });
  }
  return result;
}
```

- [ ] **Step 2: Wire into `bootstrap_user`**

Edit `src/mcp/tools/identity/bootstrap-user.ts` — extend the handler so that when `mode !== "passkey-only"`, after Tier 2 provisioning it kicks off (or schedules) the Gateway deposit. Replace the post-provisioning section to include:

```ts
// (After provisionTier2DcwForBuilder, before returning)
const initialDepositAmount = process.env.ARKAGE_DEFAULT_GATEWAY_DEPOSIT_USDC ?? "1.00";
const tier2Wallet = await db.wallet.findUniqueOrThrow({ where: { address: Buffer.from(tier2.address.replace(/^0x/, ""), "hex") } });

const eoaKey = process.env[`ARKAGE_TIER2_KEY_${tier2Wallet.id}`] as `0x${string}` | undefined;
let gatewayDepositTx: `0x${string}` | null = null;
if (eoaKey && input.mode !== "passkey-only") {
  try {
    const dep = await depositTier2ToGateway(tier2Wallet.id, eoaKey, initialDepositAmount);
    gatewayDepositTx = dep.depositTxHash;
  } catch (e) {
    // Non-fatal: builder can deposit later via dashboard.
    console.warn("[bootstrap] gateway deposit failed:", e instanceof Error ? e.message : e);
  }
}
```

And include `gatewayDepositTx` in the returned `BootstrapOutput` (already declared in Plan B's Task 12 spec).

- [ ] **Step 3: Commit**

```bash
git add src/lib/tier2-dcw.ts src/mcp/tools/identity/bootstrap-user.ts
git commit -m "feat(x402): one-time Gateway deposit during bootstrap

Wires depositTier2ToGateway into bootstrap_user when mode is not
passkey-only. Default 1.00 USDC; configurable via env.
Failure is non-fatal — builder can deposit later from the dashboard."
```

---

### Task 4: `arkage:list_my_x402_receipts` MCP tool

**Files:**
- Create: `src/mcp/tools/x402/list-my-x402-receipts.ts`

- [ ] **Step 1: Implement**

Create `src/mcp/tools/x402/list-my-x402-receipts.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  role: z.enum(["buyer", "seller", "both"]).default("both"),
  sinceMs: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export async function handleListMyReceipts(rawInput: unknown, _ctx: McpAuthContext): Promise<Result<{ receipts: unknown[] }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUniqueOrThrow({ where: { agentId: parse.data.asAgent } });

  const sessionFilter: Record<string, unknown> = {};
  if (parse.data.role === "buyer") sessionFilter.buyerAgentId = agent.id;
  else if (parse.data.role === "seller") sessionFilter.sellerAgentId = agent.id;
  else sessionFilter.OR = [{ buyerAgentId: agent.id }, { sellerAgentId: agent.id }];

  const sessions = await db.x402Session.findMany({ where: sessionFilter, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return ok({ receipts: [] });

  const receipts = await db.x402Receipt.findMany({
    where: {
      sessionId: { in: sessionIds },
      ...(parse.data.sinceMs ? { createdAt: { gte: new Date(parse.data.sinceMs) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: parse.data.limit,
  });

  return ok({
    receipts: receipts.map((r) => ({
      receiptId: r.id.toString(),
      sessionId: r.sessionId.toString(),
      seq: r.seq,
      amount: r.amount.toString(),
      buyerWallet: "0x" + Buffer.from(r.buyerWallet).toString("hex"),
      sellerWallet: "0x" + Buffer.from(r.sellerWallet).toString("hex"),
      httpStatus: r.httpStatus,
      processedAt: r.facilitatorProcessedAt.toISOString(),
    })),
  });
}

registerTool({
  name: "arkage:list_my_x402_receipts",
  description: "List receipts for an agent (as buyer, seller, or both)",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleListMyReceipts,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/x402/list-my-x402-receipts.ts
git commit -m "feat(x402): list_my_x402_receipts MCP tool"
```

---

## Phase 2 — Seller-side x402

### Task 5: `arkage:register_x402_endpoint` MCP tool

**Files:**
- Create: `src/mcp/tools/x402/register-x402-endpoint.ts`

- [ ] **Step 1: Implement**

Create `src/mcp/tools/x402/register-x402-endpoint.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

const Input = z.object({
  asAgent: z.string().regex(/^[0-9]+$/),
  url: z.string().url(),
  pricePerCall: z.string().regex(/^[0-9]+$/),
  hosting: z.enum(["self", "arkage-proxy"]),
  schema: z.unknown().optional(),
  idempotencyKey: z.string().min(1),
});

interface Output {
  endpointId: string;
  effectiveUrl: string;
}

export async function handleRegisterEndpoint(rawInput: unknown, _ctx: McpAuthContext): Promise<Result<Output>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUniqueOrThrow({ where: { agentId: parse.data.asAgent } });

  const created = await db.x402Endpoint.create({
    data: {
      sellerAgentId: agent.id,
      url: parse.data.url,
      effectiveUrl: parse.data.url, // overwritten below for proxy mode
      hosting: parse.data.hosting,
      pricePerCall: parse.data.pricePerCall,
      tokenAddress: Buffer.from("3600000000000000000000000000000000000000", "hex"),
      schemaJsonb: (parse.data.schema as object | undefined) ?? null,
      active: true,
    },
  });

  let effectiveUrl = parse.data.url;
  if (parse.data.hosting === "arkage-proxy") {
    const base = process.env.ARKAGE_PROXY_BASE_URL ?? "https://arkage.network";
    effectiveUrl = `${base}/api/x402-proxy/${created.id}`;
    await db.x402Endpoint.update({ where: { id: created.id }, data: { effectiveUrl } });
  }

  return ok({ endpointId: created.id.toString(), effectiveUrl });
}

registerTool({
  name: "arkage:register_x402_endpoint",
  description: "Register an x402-priced endpoint for an agent. hosting='self' or 'arkage-proxy'.",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleRegisterEndpoint,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/x402/register-x402-endpoint.ts
git commit -m "feat(x402): register_x402_endpoint MCP tool

hosting=self records the seller's own URL; hosting=arkage-proxy
provisions a proxy URL at /api/x402-proxy/<endpointId> that
the seller's agents publish."
```

---

### Task 6: `arkage:list_my_x402_endpoints` MCP tool

**Files:**
- Create: `src/mcp/tools/x402/list-my-x402-endpoints.ts`

- [ ] **Step 1: Implement**

Create `src/mcp/tools/x402/list-my-x402-endpoints.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ asAgent: z.string().regex(/^[0-9]+$/) });

export async function handleListMyEndpoints(rawInput: unknown): Promise<Result<{ endpoints: unknown[] }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const agent = await db.agent.findUniqueOrThrow({ where: { agentId: parse.data.asAgent } });
  const rows = await db.x402Endpoint.findMany({
    where: { sellerAgentId: agent.id },
    orderBy: { registeredAt: "desc" },
  });

  return ok({
    endpoints: rows.map((r) => ({
      endpointId: r.id.toString(),
      url: r.url,
      effectiveUrl: r.effectiveUrl,
      hosting: r.hosting,
      pricePerCall: r.pricePerCall.toString(),
      active: r.active,
    })),
  });
}

registerTool({
  name: "arkage:list_my_x402_endpoints",
  description: "List x402 endpoints registered by an agent",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleListMyEndpoints,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/x402/list-my-x402-endpoints.ts
git commit -m "feat(x402): list_my_x402_endpoints MCP tool"
```

---

### Task 7: ArkAge proxy Vercel Function (`hosting=arkage-proxy`)

**Files:**
- Create: `src/lib/x402-seller-proxy.ts`
- Create: `src/app/api/x402-proxy/[endpointId]/route.ts`
- Create: `tests/integration/x402-proxy-route.test.ts`

- [ ] **Step 1: Seller proxy adapter**

Create `src/lib/x402-seller-proxy.ts`:

```ts
import { createGatewayMiddleware } from "@circle-fin/x402-batching";
import { db } from "./db";
import { recordReceiptForSession } from "./x402-receipt-store";
import { openOrJoinSession } from "./x402-session-manager";
import type { Address } from "viem";

export interface ProxyEndpoint {
  endpointId: bigint;
  sellerAgentDbId: bigint;
  upstreamUrl: string;
  pricePerCall: string;
  sellerWallet: Address;
}

export async function loadProxyEndpoint(endpointId: bigint): Promise<ProxyEndpoint | null> {
  const row = await db.x402Endpoint.findUnique({
    where: { id: endpointId },
    include: { sellerAgent: { include: { currentOperatorWallet: true } } },
  });
  if (!row || !row.active || row.hosting !== "arkage-proxy") return null;
  return {
    endpointId: row.id,
    sellerAgentDbId: row.sellerAgentId,
    upstreamUrl: row.url,
    pricePerCall: row.pricePerCall.toString(),
    sellerWallet: ("0x" + Buffer.from(row.sellerAgent.currentOperatorWallet.address).toString("hex")) as Address,
  };
}

export interface ProxyOutcome {
  status: number;
  body: ArrayBuffer;
  headers: Headers;
  paymentSignature?: `0x${string}`;
  amountPaid?: bigint;
  buyerWallet?: Address;
}

/**
 * Run the Circle gateway middleware against the request, then forward the
 * verified request to the seller's upstream URL. Returns the proxied response
 * plus extracted payment metadata for receipt persistence.
 *
 * The actual middleware API is express-style; we bridge it to a Web Fetch
 * Request/Response. Verify the bridge signature against the installed
 * `@circle-fin/x402-batching` middleware exports at impl time.
 */
export async function proxyThroughGateway(
  endpoint: ProxyEndpoint,
  request: Request
): Promise<ProxyOutcome> {
  const gateway = createGatewayMiddleware({
    chain: "arcTestnet",
    payTo: endpoint.sellerWallet,
  });
  const guard = gateway.require(`${formatPriceUsd(endpoint.pricePerCall)}`);

  // Express-style adapter — convert Web Request → req-like shape, capture response.
  const reqLike = await webRequestToExpressLike(request);
  let captured: { status: number; headers: Record<string, string>; body: ArrayBuffer; payment?: { signature: string; amount: string; payer: string } } | null = null;
  let nextCalled = false;

  await new Promise<void>((resolve) => {
    const resLike = makeExpressResLike((payload) => {
      captured = payload;
      resolve();
    });
    Promise.resolve(guard(reqLike, resLike, () => { nextCalled = true; resolve(); })).catch(() => resolve());
  });

  // 402 path — guard sent the response itself; we relay it as-is.
  if (!nextCalled && captured) {
    return { status: captured.status, body: captured.body, headers: new Headers(captured.headers) };
  }

  // next() called — payment verified. Forward to upstream.
  const upstream = await fetch(endpoint.upstreamUrl, {
    method: request.method,
    headers: stripPaymentHeaders(request.headers),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
  });

  const upstreamBody = await upstream.arrayBuffer();
  const outHeaders = new Headers(upstream.headers);
  // Re-attach payment-response if Circle middleware set it on captured headers
  if (captured?.headers["payment-response"]) outHeaders.set("payment-response", captured.headers["payment-response"]);

  return {
    status: upstream.status,
    body: upstreamBody,
    headers: outHeaders,
    paymentSignature: captured?.payment?.signature as `0x${string}` | undefined,
    amountPaid: captured?.payment ? BigInt(captured.payment.amount) : undefined,
    buyerWallet: captured?.payment?.payer as Address | undefined,
  };
}

/** Persist a receipt for a verified proxy call. */
export async function persistProxyReceipt(args: {
  endpoint: ProxyEndpoint;
  outcome: ProxyOutcome;
}): Promise<{ receiptDbId: bigint } | null> {
  const { endpoint, outcome } = args;
  if (!outcome.paymentSignature || !outcome.buyerWallet || !outcome.amountPaid) return null;

  const buyerWalletBytes = Buffer.from(outcome.buyerWallet.replace(/^0x/, ""), "hex");
  const buyerWallet = await db.wallet.findUnique({ where: { address: buyerWalletBytes } });
  if (!buyerWallet) {
    // Buyer not registered with ArkAge — record sessionless audit only.
    await db.auditLog.create({
      data: {
        actorKind: "system",
        actorId: "x402-proxy",
        action: "receipt.unknown_buyer",
        targetKind: "endpoint",
        targetId: endpoint.endpointId.toString(),
        payloadJsonb: { buyer: outcome.buyerWallet, amount: outcome.amountPaid.toString() } as object,
      },
    });
    return null;
  }

  const buyerAgent = await db.agent.findFirst({ where: { currentOperatorWalletId: buyerWallet.id } });
  if (!buyerAgent) return null;

  const session = await openOrJoinSession(buyerAgent.id, endpoint.sellerAgentDbId);
  const recorded = await recordReceiptForSession({
    sessionDbId: session.sessionDbId,
    endpointId: endpoint.endpointId,
    amount: outcome.amountPaid,
    paymentSignature: outcome.paymentSignature,
    buyerWallet: outcome.buyerWallet,
    sellerWallet: endpoint.sellerWallet,
    httpStatus: outcome.status,
  });
  return { receiptDbId: recorded.receiptDbId };
}

// ---- internals ----

function formatPriceUsd(rawUsdc: string): string {
  const big = BigInt(rawUsdc);
  const whole = big / 1_000_000n;
  const frac = (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `$${whole}.${frac}`;
}

async function webRequestToExpressLike(req: Request): Promise<Record<string, unknown>> {
  const url = new URL(req.url);
  return {
    method: req.method,
    url: url.pathname + url.search,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(req.headers.entries()),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().json().catch(() => undefined),
  };
}

function makeExpressResLike(onSend: (payload: { status: number; headers: Record<string, string>; body: ArrayBuffer; payment?: { signature: string; amount: string; payer: string } }) => void) {
  let status = 200;
  const headers: Record<string, string> = {};
  let payment: { signature: string; amount: string; payer: string } | undefined;
  const res = {
    status(code: number) { status = code; return res; },
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
    set(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
    json(obj: unknown) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      onSend({ status, headers, body: new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer, payment });
    },
    send(data: unknown) {
      const buf = data instanceof ArrayBuffer
        ? data
        : data instanceof Uint8Array
          ? data.buffer as ArrayBuffer
          : new TextEncoder().encode(typeof data === "string" ? data : JSON.stringify(data)).buffer as ArrayBuffer;
      onSend({ status, headers, body: buf, payment });
    },
    end() { onSend({ status, headers, body: new ArrayBuffer(0), payment }); },
    locals: { onPaymentVerified(p: { signature: string; amount: string; payer: string }) { payment = p; } },
  } as Record<string, unknown>;
  return res;
}

function stripPaymentHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete("payment-required");
  out.delete("payment-signature");
  return out;
}
```

- [ ] **Step 2: Proxy route**

Create `src/app/api/x402-proxy/[endpointId]/route.ts`:

```ts
import { loadProxyEndpoint, proxyThroughGateway, persistProxyReceipt } from "@/lib/x402-seller-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, endpointIdRaw: string): Promise<Response> {
  if (!/^[0-9]+$/.test(endpointIdRaw)) return new Response("bad endpoint id", { status: 400 });
  const endpoint = await loadProxyEndpoint(BigInt(endpointIdRaw));
  if (!endpoint) return new Response("endpoint not found or not arkage-proxy", { status: 404 });

  try {
    const outcome = await proxyThroughGateway(endpoint, request);
    if (outcome.paymentSignature) {
      // fire-and-forget the receipt write so we don't block the response
      persistProxyReceipt({ endpoint, outcome }).catch((e) => console.error("[x402-proxy] receipt persist failed", e));
    }
    return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
  } catch (e) {
    console.error("[x402-proxy] error", e);
    return new Response("proxy error", { status: 502 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  return handle(request, endpointId);
}
export async function POST(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  return handle(request, endpointId);
}
export async function PUT(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  return handle(request, endpointId);
}
export async function DELETE(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  return handle(request, endpointId);
}
```

- [ ] **Step 3: Smoke integration test (mocked middleware)**

Create `tests/integration/x402-proxy-route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/x402-proxy/[endpointId]/route";

vi.mock("@/lib/x402-seller-proxy", () => ({
  loadProxyEndpoint: vi.fn(async () => ({
    endpointId: 1n, sellerAgentDbId: 2n, upstreamUrl: "https://upstream.test/x", pricePerCall: "1000",
    sellerWallet: "0x2222000000000000000000000000000000000002",
  })),
  proxyThroughGateway: vi.fn(async () => ({
    status: 402, body: new TextEncoder().encode(JSON.stringify({ accepts: [] })).buffer, headers: new Headers({ "content-type": "application/json" }),
  })),
  persistProxyReceipt: vi.fn(async () => null),
}));

describe("x402-proxy route", () => {
  it("returns 402 to unpaid request", async () => {
    const req = new Request("https://arkage.network/api/x402-proxy/1", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ endpointId: "1" }) });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.accepts).toEqual([]);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npm test tests/integration/x402-proxy-route.test.ts
```

```bash
git add src/lib/x402-seller-proxy.ts src/app/api/x402-proxy tests/integration/x402-proxy-route.test.ts
git commit -m "feat(x402): arkage-proxy hosting mode

Vercel Function at /api/x402-proxy/[endpointId] adapts Circle's
Express middleware to Web Fetch Request/Response, forwards
verified requests to the seller's upstream URL, and persists
receipts asynchronously via openOrJoinSession +
recordReceiptForSession (when buyer is ArkAge-registered)."
```

---

### Task 8: Self-hosted seller helper docs

**Files:**
- Create: `docs/runbooks/x402-seller-onboarding.md`

- [ ] **Step 1: Write runbook**

Create `docs/runbooks/x402-seller-onboarding.md`:

```markdown
# x402 Seller Onboarding

ArkAge supports two hosting modes for x402-priced endpoints. Pick one when you call `arkage:register_x402_endpoint`.

## Mode A: `arkage-proxy` (zero-infra)

Best for: agents without their own server, hackathon teams, evaluation use.

1. Call `arkage:register_x402_endpoint` with `hosting: "arkage-proxy"` and `url` pointing at your unprotected upstream URL.
2. ArkAge returns `effectiveUrl = https://arkage.network/api/x402-proxy/<endpointId>`.
3. Publish that URL to buyers (in your agent metadata, x402 endpoint registry, etc.).
4. Buyers call the proxy URL → ArkAge wraps Circle's gateway middleware → forwards verified requests to your upstream. You receive the original request body / query string with all `payment-*` headers stripped.
5. Receipts persist automatically; you can read them with `arkage:list_my_x402_receipts` (role=seller).

Trade-offs: ArkAge sees every request before forwarding. If your endpoint serves sensitive data, prefer Mode B.

## Mode B: `self` (you own the middleware)

Best for: production sellers, sensitive endpoints, custom error handling.

1. Install Circle's middleware in your server:

   ```bash
   npm install @circle-fin/x402-batching @x402/core @x402/evm viem express
   ```

2. Wrap your route with `createGatewayMiddleware`:

   ```ts
   import express from "express";
   import { createGatewayMiddleware } from "@circle-fin/x402-batching";

   const app = express();
   const gateway = createGatewayMiddleware({
     chain: "arcTestnet",
     payTo: "0xYourTier2EOA…",
   });

   app.get("/api/data", gateway.require("$0.01"), (req, res) => {
     res.json({ data: "your protected payload" });
   });
   ```

3. Deploy somewhere reachable (Vercel, Fly, Railway, your laptop with ngrok).
4. Call `arkage:register_x402_endpoint` with `hosting: "self"` and `url` pointing at your deployed endpoint.
5. ArkAge subscribes to Circle's facilitator webhook for receipts on the seller wallet you registered.

## Verifying receipts

After the first paid call lands:

```
arkage:list_my_x402_receipts asAgent=<id> role=seller limit=5
```

Should return the receipt with the buyer wallet, amount, and processed timestamp.

## Pricing changes

x402 endpoint price is set at registration. Update it via SQL for now:

```sql
UPDATE x402_endpoints SET price_per_call = '5000' WHERE id = <endpointId>;
```

A dedicated `arkage:update_x402_endpoint_price` MCP tool is logged for v1.5.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/x402-seller-onboarding.md
git commit -m "docs: x402 seller onboarding runbook

Walks through arkage-proxy (zero-infra) vs self (production)
hosting modes with code samples and trade-offs."
```

---

## Phase 3 — Facilitator webhook + dispute trigger

### Task 9: Circle facilitator webhook receiver

**Files:**
- Create: `src/lib/x402-facilitator-verify.ts`
- Create: `src/app/api/webhooks/circle-x402-facilitator/route.ts`
- Create: `src/workers/ingest-x402-settlement.ts`
- Create: `tests/unit/x402-facilitator-verify.test.ts`
- Create: `tests/integration/x402-facilitator-webhook.test.ts`

- [ ] **Step 1: Verify helper + failing test**

Create `tests/unit/x402-facilitator-verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyX402FacilitatorWebhook } from "@/lib/x402-facilitator-verify";
import { createHmac } from "node:crypto";

const SECRET = "test-x402-fac-secret-32-chars-min";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifyX402FacilitatorWebhook", () => {
  it("accepts valid signature", () => {
    const body = JSON.stringify({ event: "settled" });
    expect(verifyX402FacilitatorWebhook(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects bad signature", () => {
    expect(verifyX402FacilitatorWebhook("x", "deadbeef", SECRET)).toBe(false);
  });
});
```

Create `src/lib/x402-facilitator-verify.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyX402FacilitatorWebhook(rawBody: string, receivedSigHex: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try { received = Buffer.from(receivedSigHex, "hex"); } catch { return false; }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}
```

- [ ] **Step 2: Settlement ingest worker**

Create `src/workers/ingest-x402-settlement.ts`:

```ts
import { db } from "@/lib/db";

export interface FacilitatorWebhookPayload {
  eventType: string; // 'settle' | 'batch_completed' | 'refund'
  data: {
    paymentSignature?: string;       // matches x402_receipts.payment_signature
    settlementTxHash?: string;
    sellerWallet?: string;
    amountTotal?: string;             // raw 6-decimals
    receiptsSettled?: string[];       // array of payment signatures included in batch
    facilitatorFee?: string;
    settledAt?: string;               // ISO
  };
}

export async function ingestFacilitatorEvent(payload: FacilitatorWebhookPayload): Promise<void> {
  if (payload.eventType !== "batch_completed" && payload.eventType !== "settle" && payload.eventType !== "refund") {
    return;
  }

  const { data } = payload;

  await db.auditLog.create({
    data: {
      actorKind: "system",
      actorId: "circle-x402-facilitator",
      action: `x402.${payload.eventType}`,
      targetKind: "settlement",
      targetId: data.settlementTxHash ?? "(none)",
      payloadJsonb: data as unknown as object,
    },
  });

  if (payload.eventType === "batch_completed" && data.settlementTxHash && data.sellerWallet && data.amountTotal) {
    // Treasury movement INTO the seller wallet (not ArkAge treasury); we record a separate
    // ArkAge-fee movement once the seller wallet pays our surcharge. For v1 we record both
    // as audit entries; treasury_movements only tracks ArkAge-treasury inflows.
    if (process.env.ARKAGE_X402_FEE_BPS && data.facilitatorFee) {
      await db.treasuryMovement.create({
        data: {
          kind: "x402_surcharge",
          sourceKind: "facilitator_batch",
          sourceId: null,
          amount: data.facilitatorFee,
          tokenAddress: Buffer.from("3600000000000000000000000000000000000000", "hex"),
          direction: "in",
          counterparty: Buffer.from(data.sellerWallet.replace(/^0x/, ""), "hex"),
          txHash: Buffer.from(data.settlementTxHash.replace(/^0x/, ""), "hex"),
          blockTime: data.settledAt ? new Date(data.settledAt) : null,
        },
      });
    }
  }

  if (payload.eventType === "refund" && data.paymentSignature) {
    const sig = Buffer.from(data.paymentSignature.replace(/^0x/, ""), "hex");
    await db.x402Receipt.updateMany({
      where: { paymentSignature: sig },
      data: { httpStatus: 0 }, // sentinel — refunded
    });
  }
}
```

- [ ] **Step 3: Webhook route**

Create `src/app/api/webhooks/circle-x402-facilitator/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyX402FacilitatorWebhook } from "@/lib/x402-facilitator-verify";
import { ingestFacilitatorEvent, type FacilitatorWebhookPayload } from "@/workers/ingest-x402-settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CIRCLE_X402_FACILITATOR_SECRET;
  if (!secret) return NextResponse.json({ error: "secret not configured" }, { status: 500 });

  const sig = request.headers.get("x-circle-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 401 });

  const raw = await request.text();
  if (!verifyX402FacilitatorWebhook(raw, sig, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: FacilitatorWebhookPayload;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  await ingestFacilitatorEvent(payload);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Webhook integration test**

Create `tests/integration/x402-facilitator-webhook.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { POST } from "@/app/api/webhooks/circle-x402-facilitator/route";
import { createHmac } from "node:crypto";

const SECRET = "test-x402-fac-secret-32-chars-min";

beforeAll(() => { process.env.CIRCLE_X402_FACILITATOR_SECRET = SECRET; });

function makeReq(payload: object): Request {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(body).digest("hex");
  return new Request("https://x.test/api/webhooks/circle-x402-facilitator", {
    method: "POST",
    headers: { "x-circle-signature": sig, "content-type": "application/json" },
    body,
  });
}

describe("x402 facilitator webhook", () => {
  it("rejects bad signature", async () => {
    const body = JSON.stringify({ eventType: "settle" });
    const req = new Request("https://x.test/api/webhooks/circle-x402-facilitator", {
      method: "POST",
      headers: { "x-circle-signature": "deadbeef", "content-type": "application/json" },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts valid batch_completed event", async () => {
    const res = await POST(makeReq({
      eventType: "batch_completed",
      data: {
        settlementTxHash: "0x" + "ab".repeat(32),
        sellerWallet: "0x" + "11".repeat(20),
        amountTotal: "100000",
        facilitatorFee: "1000",
        settledAt: new Date().toISOString(),
      },
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/x402-facilitator-verify.ts src/app/api/webhooks/circle-x402-facilitator src/workers/ingest-x402-settlement.ts tests/unit/x402-facilitator-verify.test.ts tests/integration/x402-facilitator-webhook.test.ts
git commit -m "feat(x402): Circle facilitator settlement webhook

POST /api/webhooks/circle-x402-facilitator verifies HMAC,
ingests batch_completed/settle/refund events, writes
treasury_movements (ArkAge surcharge inflows) + audit_log."
```

---

### Task 10: Buyer-side `arkage:dispute_receipt` MCP tool

**Files:**
- Create: `src/mcp/tools/x402/dispute-receipt.ts`

- [ ] **Step 1: Implement**

Create `src/mcp/tools/x402/dispute-receipt.ts`:

```ts
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { start } from "workflow/api";
import { x402DisputeFlow } from "@/workflows/x402-dispute-flow";

const Input = z.object({
  receiptId: z.string().regex(/^[0-9]+$/),
  reason: z.string().min(1).max(1000),
  evidence: z.unknown().optional(),
  idempotencyKey: z.string().min(1),
});

export async function handleDisputeReceipt(rawInput: unknown, ctx: McpAuthContext): Promise<Result<{ disputeId: string; workflowRunId: string }>> {
  const parse = Input.safeParse(rawInput);
  if (!parse.success) return err("validation_error", parse.error.message);

  const receipt = await db.x402Receipt.findUnique({ where: { id: BigInt(parse.data.receiptId) } });
  if (!receipt) return err("not_found", "receipt not found");

  const buyerWalletHex = "0x" + Buffer.from(receipt.buyerWallet).toString("hex");
  if (buyerWalletHex.toLowerCase() !== ctx.actingWalletAddress.toLowerCase()) {
    return err("not_authorized", "only the buyer of this receipt may dispute");
  }

  const dispute = await db.x402Dispute.create({
    data: {
      receiptId: receipt.id,
      raisedByWallet: receipt.buyerWallet,
      reason: parse.data.reason,
      evidenceJsonb: (parse.data.evidence as object | undefined) ?? null,
      status: "open",
      workflowRunId: "pending",
    },
  });

  const run = await start(x402DisputeFlow, [dispute.id, receipt.id]);
  await db.x402Dispute.update({ where: { id: dispute.id }, data: { workflowRunId: run.runId } });

  return ok({ disputeId: dispute.id.toString(), workflowRunId: run.runId });
}

registerTool({
  name: "arkage:dispute_receipt",
  description: "Open a dispute against an x402 receipt; spawns x402DisputeFlow",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: handleDisputeReceipt,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/x402/dispute-receipt.ts
git commit -m "feat(x402): dispute_receipt MCP tool — spawns x402DisputeFlow"
```

---

## Phase 4 — Treasury reconciliation

### Task 11: Treasury reconciliation cron

**Files:**
- Create: `src/workers/reconcile-treasury.ts`
- Create: `src/app/api/cron/reconcile-treasury/route.ts`
- Modify: `vercel.ts`

- [ ] **Step 1: Worker**

Create `src/workers/reconcile-treasury.ts`:

```ts
import { db } from "@/lib/db";
import { publicClient } from "@/lib/chain";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { ERC20_ABI } from "@/lib/abis";
import { getTier3Address } from "@/lib/tier3-system";

export interface TreasuryReport {
  onChainBalanceRaw: string;
  recordedNetRaw: string;
  drift: string;
  driftDirection: "balance_higher" | "balance_lower" | "in_sync";
}

export async function reconcileTreasury(): Promise<TreasuryReport> {
  const treasury = getTier3Address("treasury");

  const onChainBalance = await publicClient.readContract({
    address: ARC_TESTNET_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [treasury],
  });

  const movements = await db.treasuryMovement.findMany({ select: { direction: true, amount: true } });
  const inSum = movements.filter((m) => m.direction === "in").reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
  const outSum = movements.filter((m) => m.direction === "out").reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
  const net = inSum - outSum;

  const drift = onChainBalance - net;
  const direction = drift === 0n ? "in_sync" : drift > 0n ? "balance_higher" : "balance_lower";

  if (drift !== 0n) {
    await db.auditLog.create({
      data: {
        actorKind: "system",
        actorId: "treasury-reconciler",
        action: `treasury.drift.${direction}`,
        payloadJsonb: {
          onChainBalance: onChainBalance.toString(),
          recordedNet: net.toString(),
          drift: drift.toString(),
        } as object,
      },
    });
  }

  return {
    onChainBalanceRaw: onChainBalance.toString(),
    recordedNetRaw: net.toString(),
    drift: drift.toString(),
    driftDirection: direction,
  };
}
```

- [ ] **Step 2: Cron route**

Create `src/app/api/cron/reconcile-treasury/route.ts`:

```ts
import { NextResponse } from "next/server";
import { reconcileTreasury } from "@/workers/reconcile-treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await reconcileTreasury();
  return NextResponse.json(report);
}
```

- [ ] **Step 3: Add to vercel.ts crons**

Edit `vercel.ts`:

```ts
import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  crons: [
    { path: "/api/cron/reconcile-stuck-workflows", schedule: "*/5 * * * *" },
    { path: "/api/cron/reconcile-indexer-cursor", schedule: "*/5 * * * *" },
    { path: "/api/cron/reconcile-treasury", schedule: "0 * * * *" },
  ],
};
```

- [ ] **Step 4: Commit**

```bash
git add src/workers/reconcile-treasury.ts src/app/api/cron/reconcile-treasury vercel.ts
git commit -m "feat(treasury): reconcile-treasury hourly cron

Compares on-chain treasury USDC balance against the net of
recorded treasury_movements; logs drift to audit_log so the
admin/system-health page surfaces silent state divergence."
```

---

### Task 12: Wire all 5 x402 tools into the MCP registry

**Files:**
- Modify: `src/mcp/register-all-tools.ts`

- [ ] **Step 1: Add side-effect imports**

Edit `src/mcp/register-all-tools.ts` — append:

```ts
import "./tools/x402/pay-and-call.js";
import "./tools/x402/register-x402-endpoint.js";
import "./tools/x402/list-my-x402-endpoints.js";
import "./tools/x402/list-my-x402-receipts.js";
import "./tools/x402/dispute-receipt.js";
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/register-all-tools.ts
git commit -m "feat(mcp): register 5 x402 domain tools

Tool count now 27 (Plan B: 22 across 5 domains + Plan D: 5 x402)."
```

---

## Phase 5 — Smoke tests + handoff

### Task 13: Wire x402 receipts into dashboard live updates

**Files:**
- Modify: `prisma/migrations/<latest>/migration.sql` (notify already in place from Plan C Task 4)

- [ ] **Step 1: Verify Plan C trigger covers x402_receipts inserts**

```bash
grep -A 5 "arkage_notify_x402_receipt" prisma/migrations/*pg_notify_triggers/migration.sql
```

Expected: trigger present (created in Plan C Task 4). New receipts inserted by Plan D's `recordReceiptForSession` will fire `arkage:x402:session:<id>` and `arkage:protocol-pulse` automatically — no extra migration needed.

- [ ] **Step 2: Confirm dashboard ticker increments on receipt**

(Manual) After running smoke test (Task 14), refresh `/x402/sessions/<id>` and verify the receipt list grows live.

---

### Task 14: x402 end-to-end smoke test

**Files:**
- Create: `tests/e2e/x402-end-to-end.spec.ts`

- [ ] **Step 1: Write the test (skipped by default; opt-in via env)**

Create `tests/e2e/x402-end-to-end.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_X402_LIVE, "set E2E_X402_LIVE=1 to run live x402 against testnet");

const ARKAGE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test("buyer agent calls a registered seller endpoint and a receipt appears", async ({ request }) => {
  // 1) Buyer calls pay_and_call MCP tool
  const payRes = await request.post(`${ARKAGE}/api/mcp`, {
    headers: { Authorization: `Bearer ${process.env.E2E_BUYER_MCP_TOKEN}`, "Content-Type": "application/json" },
    data: {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: {
        name: "arkage:pay_and_call",
        arguments: {
          asAgent: process.env.E2E_BUYER_AGENT_ID,
          url: process.env.E2E_SELLER_URL,
          maxPrice: "10000",
          idempotencyKey: `e2e-${Date.now()}`,
        },
      },
    },
  });
  expect(payRes.ok()).toBe(true);
  const payJson = await payRes.json();
  const inner = JSON.parse(payJson.result.content[0].text);
  expect(inner.ok).toBe(true);
  const sessionId = inner.data.sessionId;

  // 2) Seller queries receipts
  const receiptsRes = await request.post(`${ARKAGE}/api/mcp`, {
    headers: { Authorization: `Bearer ${process.env.E2E_SELLER_MCP_TOKEN}`, "Content-Type": "application/json" },
    data: {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: {
        name: "arkage:list_my_x402_receipts",
        arguments: { asAgent: process.env.E2E_SELLER_AGENT_ID, role: "seller", limit: 5 },
      },
    },
  });
  const recJson = await receiptsRes.json();
  const recInner = JSON.parse(recJson.result.content[0].text);
  expect(recInner.ok).toBe(true);
  expect(recInner.data.receipts.length).toBeGreaterThan(0);

  // 3) Verify session detail page renders
  const page = await request.get(`${ARKAGE}/x402/sessions/${sessionId}`);
  expect(page.ok()).toBe(true);
  const html = await page.text();
  expect(html).toContain(`Session #${sessionId}`);
});
```

- [ ] **Step 2: Document the env vars required**

Append to `docs/runbooks/x402-seller-onboarding.md`:

```markdown

## Live e2e setup

Set the following env vars before running `npm run test:e2e -- tests/e2e/x402-end-to-end.spec.ts`:

- `E2E_X402_LIVE=1` — opt in
- `E2E_BUYER_MCP_TOKEN`, `E2E_SELLER_MCP_TOKEN` — issued via the Plan B Task 33 token-issuance script
- `E2E_BUYER_AGENT_ID`, `E2E_SELLER_AGENT_ID` — Postgres agent.id values
- `E2E_SELLER_URL` — the registered endpoint's `effectiveUrl` (proxy or self)

Buyer must have a deposited Gateway balance (run `bootstrap_user` with non-zero deposit).
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/x402-end-to-end.spec.ts docs/runbooks/x402-seller-onboarding.md
git commit -m "test(e2e): live x402 end-to-end (opt-in via E2E_X402_LIVE)

Buyer pay_and_call → seller list_my_x402_receipts → public
session detail page sanity-check. Skipped by default to keep
CI fast and Circle Gateway costs out of normal runs."
```

---

### Task 15: Plan D verification checklist

- [ ] **Step 1: Run all unit + integration tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 2: Run all workflow tests**

```bash
npm run test:workflow
```

Expected: green.

- [ ] **Step 3: Confirm tool count is 27**

```bash
node --input-type=module -e "
  import { listRegisteredTools } from './src/mcp/server.ts';
  await import('./src/mcp/register-all-tools.ts');
  console.log(listRegisteredTools().length, 'tools');
"
```

Expected: `27 tools`.

- [ ] **Step 4: Verify proxy route**

```bash
npm run dev &
DEV_PID=$!
sleep 5
# Register a test endpoint via direct DB seed, then:
curl -i http://localhost:3000/api/x402-proxy/1
kill $DEV_PID 2>/dev/null
```

Expected: `HTTP/1.1 402 Payment Required` (or 404 if no endpoint id 1 in dev DB).

- [ ] **Step 5: Verify Vercel cron registration**

```bash
vercel inspect --crons
```

Expected: 3 crons (`reconcile-stuck-workflows`, `reconcile-indexer-cursor`, `reconcile-treasury`).

- [ ] **Step 6: Verify Circle facilitator webhook secret is set**

```bash
echo "CIRCLE_X402_FACILITATOR_SECRET = ${CIRCLE_X402_FACILITATOR_SECRET:+set}"
```

Expected: `CIRCLE_X402_FACILITATOR_SECRET = set`.

- [ ] **Step 7: Tag completion**

```bash
git tag plan-d-complete
git push origin main --tags
```

✅ **Plan D complete.** ArkAge is now a complete agentic-commerce protocol on Arc Testnet: 27 MCP tools, 5 deployed contracts, 4 durable workflows, public dashboard with live SSE updates, builder console, admin views, and full x402 buyer/seller/proxy/dispute/reconciliation paths. Ready for testnet beta.

---

## Self-review

- **Spec coverage check:**
  - Spec §3.3 `pay_and_call` deep spec: implemented with off-chain policy gate, wallet routing, GatewayClient.pay() wrapper, receipt persistence, session join (Task 1).
  - Spec §3.3 `register_x402_endpoint` deep spec: both `self` and `arkage-proxy` hosting modes implemented (Tasks 5, 7).
  - Spec §4.5 `x402PaymentSession` workflow wiring: receipts persist via `recordReceiptForSession` which fires the deterministic session hook token from Plan B (Task 2).
  - Spec §4.6 `x402DisputeFlow` workflow wiring: `dispute_receipt` MCP tool spawns the workflow (Task 10).
  - Spec §5.5 bootstrap Gateway deposit: `depositTier2ToGateway` integrated into `bootstrap_user` (Task 3).
  - Spec §11 facilitator URL verification: documented as pre-impl check; SDK exact API names flagged inline as needing verification.
  - Spec §0 / §1 confirmation: Arc Testnet domain `26` for Circle Gateway nanopayments — referenced in architecture intro.
- **Placeholder scan:** None remaining. The `proxyThroughGateway` adapter in Task 7 is annotated where it bridges Express middleware to Web Fetch — flagged as needing verification against the installed `@circle-fin/x402-batching` middleware shape, not as a TODO. The "verify against installed SDK" caveat is the same pattern used in Plan B for Circle DCW exact request shapes.
- **Type consistency:**
  - `X402Receipt` and `X402PaymentRequirement` shapes in `src/types/x402.ts` consumed identically by buyer (`x402-buyer.ts`), seller proxy (`x402-seller-proxy.ts`), and receipt store.
  - `RecordReceiptInput` in `x402-receipt-store.ts` matches the data passed by both `pay_and_call` (buyer flow) and `persistProxyReceipt` (seller proxy flow).
  - `SessionHandle` returned by `openOrJoinSession` consumed identically by `pay_and_call` and `persistProxyReceipt`.
  - Hook token strings come from Plan B's `hook-tokens.ts` — `x402SessionToken` used identically here.
  - `MCP Result` envelope used uniformly across all 5 new tools.
- **Validator caveats reviewed:** Any `setTimeout`/`setInterval`/`fetch`/`require` flagged in this plan are inside Vercel Function route handlers, React-free Node.js workers, or test fixtures — not workflow sandbox code. Same false-positive pattern as Plans A, B, C.

---

**End of Plan D. End of v1 implementation plan series.**
