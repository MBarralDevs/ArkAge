# Plan E1 — Circle Agent Wallets Onramp (Theme A execution)

> **For agentic workers:** Execute task-by-task with `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Each task is bite-sized (~2-5 min) with TDD discipline.

**Parent:** Plan E (`2026-05-11-plan-e-v1.5-circle-agent-stack-integration.md`), Theme A.

**Goal:** Let a builder onboard an ArkAge agent backed by a **Circle Agent Wallet** in under 5 minutes — without ArkAge ever holding Circle session credentials or private keys. Replace the v1 `ARKAGE_TIER2_KEY_<walletId>` env-staged-private-key workaround.

---

## Reality check — what Circle actually ships

After reading the official docs (memory: `reference_circle_agent_wallets_facts.md`), the v1.5 Theme A assumptions in Plan E need correction. The biggest:

| Plan E assumption | Reality |
|---|---|
| `@circle-fin/agent-wallets` SDK with programmatic API | **No SDK.** Only `@circle-fin/cli` (npm install global, Node 20.18.2+). All ops are CLI subprocess invocations. |
| ArkAge provisions wallets server-side | **Impossible.** Auth is email OTP, sessions are 7-day, bound to builder's email. ArkAge holding the session = ArkAge holding custody-equivalent. Breaks Circle's pitch. |
| Mirror Circle's policy schema into PolicyHook | **Testnet has no Circle policies.** "Spending policies require a mainnet agent wallet. Testnet is not supported." On Arc Testnet, PolicyHook stays the sole policy layer (already the v1 design). |
| ERC-7710 session keys via Circle | **Not shipped.** Custom policies only cover allow/blocklists + spend caps. No session-key DSL. Theme C in Plan E is therefore deferred — re-evaluate when Circle ships session keys. |
| ArkAge calls `client.deposit()` to fund Tier 2 Gateway | **Replaced by `circle wallet fund` + `circle gateway deposit` CLI**, and testnet wallets are auto-funded with 20 USDC. |

What we **gain** that v1 lacked:
- **Auto-funded testnet wallets** (20 USDC, no manual faucet bookmark)
- **Gas sponsorship** — no Tier 3 gas-funder needed for any flow through an Agent Wallet
- **Sanctions screening** — Circle screens transfers automatically
- **`circle services pay`** — productized x402 client that abstracts the Gateway batched scheme
- **`circle wallet execute`** — arbitrary contract calls via function-signature-string ABI (works for our ERC-8004 + AgentRegistry calls)

What we **lose**:
- Programmatic wallet provisioning. Builders must install Circle CLI and log in themselves.
- Same-process signing for ArkAge-specific custom flows. Going through subprocess + CLI session.

---

## Strategic reframe (refining Plan E's positioning)

ArkAge sits **above** Circle's plumbing — and explicitly does **not** hold Circle session credentials. The model is:

```
Builder's environment                  ArkAge (Vercel)                  On-chain
─────────────────────                  ───────────────                  ────────
[Circle CLI session                                                     
 logged in as
 builder@example.com]                                                   
                                                                        
       ↓                                                                
[agent runtime,                  ←→  [registry, reputation,    ←→  [PolicyHook,
 spawns `circle ...` ]                disputes, evaluator]          AgentRegistry,
                                                                    ERC-8004,
                                                                    ERC-8183]
```

ArkAge **registers** an Agent Wallet address as Tier 2 for an agent. It does not provision the wallet. It does not hold the session. The agent runtime — which lives wherever the Circle CLI is logged in — spawns Circle commands to act.

This is **stronger** positioning than Plan E assumed:
- ArkAge can never custody-leak Circle wallets; we structurally can't.
- Builders bring any EVM address as Tier 2 — Circle Agent Wallet or otherwise. The "Circle path" is just the recommended onboarding flow.

---

## File structure produced by this plan

```
ArkAge/
├── src/
│   ├── mcp/
│   │   └── tools/
│   │       └── identity/
│   │           ├── register-agent-wallet.ts                # MODIFIED: accept circleAgentWallet flag
│   │           └── bootstrap-user.ts                       # MODIFIED: optional Circle path
│   ├── lib/
│   │   ├── circle-cli.ts                                   # NEW: thin subprocess wrapper around `circle`
│   │   ├── wallet-router.ts                                # MODIFIED: recognize `kind: "circle-agent-wallet"`
│   │   └── x402-buyer.ts                                   # MODIFIED: route via `circle services pay` when Tier 2 is Circle-backed
│   ├── app/
│   │   └── console/
│   │       └── agents/
│   │           └── new/
│   │               └── circle-wallet-step.tsx              # NEW: console UI for Circle path
│   └── workers/
│       └── nothing-new                                     # gas-funder stays; Circle gas-sponsorship is opt-in per-wallet
├── prisma/
│   └── migrations/
│       └── 2026XXXXXXXXXX_circle_agent_wallet_column/
│           └── migration.sql                               # NEW: wallets.circle_agent_wallet_email + wallets.kind
├── scripts/
│   ├── smoke-register-circle-agent.ts                      # NEW: replaces smoke-register-external-tier2.ts
│   └── (REMOVE) smoke-register-external-tier2.ts           # superseded by above (kept until smoke passes, then deleted)
├── tests/
│   ├── unit/
│   │   └── circle-cli.test.ts                              # NEW
│   └── integration/
│       └── register-circle-agent.test.ts                   # NEW
└── docs/runbooks/
    └── circle-agent-wallet-onboarding.md                   # NEW
```

---

## Pre-flight (do these once before starting Task 1)

- [ ] Verify Circle CLI installs cleanly on a fresh machine: `npm install -g @circle-fin/cli && circle --version`
- [ ] Verify Arc Testnet is in `circle blockchain list --output json` (chain code `ARC-TESTNET`)
- [ ] Run the full first-time login flow on a test email: `circle wallet login dev@example.com`, paste OTP, verify `circle wallet list --type agent --chain ARC-TESTNET --output json` returns a wallet
- [ ] Confirm testnet wallet shows 20 USDC: `circle wallet balance --address <addr> --chain ARC-TESTNET`
- [ ] Test a contract execute call against a no-op address: `circle wallet execute "balanceOf(address)" 0x0 --contract 0x3600000000000000000000000000000000000000 --address <addr> --chain ARC-TESTNET --output json` (will fail — confirms error shape)
- [ ] Document the JSON output shapes seen in pre-flight in `docs/runbooks/circle-agent-wallet-onboarding.md` so subsequent tasks have ground-truth examples

---

## Phase 1 — Data model

### Task 1: Migration — extend `wallets` table

- [ ] Add `kind` enum column to `wallets`: `'circle-modular' | 'circle-dcw-eoa' | 'circle-agent-wallet' | 'external-eoa'`
- [ ] Add nullable `circle_agent_wallet_email TEXT` (so we know who can sign for it)
- [ ] Backfill existing rows: any row with `circleWalletId IS NOT NULL` → `kind = 'circle-dcw-eoa'`; else `kind = 'external-eoa'`
- [ ] Add CHECK constraint: `kind = 'circle-agent-wallet'` ⇒ `circle_agent_wallet_email IS NOT NULL`
- [ ] Generate with `npx prisma migrate dev --name circle_agent_wallet_column`
- [ ] Verify migration applies cleanly on a fresh DB

### Task 2: Update `wallet-router.ts` typing

- [ ] Extend the `WalletKind` union to include `"circle-agent-wallet"`
- [ ] Update `route()` to return a typed `kind` so downstream code can dispatch
- [ ] Add unit test: routing a `circle-agent-wallet` returns the right routing tag
- [ ] Confirm the existing v1 wallet-routing tests still pass

---

## Phase 2 — Circle CLI subprocess wrapper

### Task 3: `src/lib/circle-cli.ts` — minimal client

- [ ] Export `circleCli({ args, env?, cwd? })` — spawns the `circle` binary, always with `--output json`
- [ ] Reject if exit code ≠ 0; stderr → error message
- [ ] Reject after a configurable timeout (default 60s)
- [ ] Inject `CIRCLE_ACCEPT_TERMS=1` automatically (we never want to block on Terms in a server context)
- [ ] Add unit test that mocks `child_process.spawn` and asserts arg array
- [ ] **Do NOT** ship this module to production runtime paths yet — the wrapper is for **local agent runtime** + **smoke scripts** only. ArkAge's Vercel functions must not spawn `circle` (no CLI in serverless env).

### Task 4: `verifyCircleAgentWallet(address, chain)` helper

- [ ] Calls `circle wallet list --type agent --chain <chain> --output json`
- [ ] Parses the result, finds the matching address
- [ ] Returns `{ exists: true, email: <session email>, autoFundedUsdc: <bigint> }` or `{ exists: false }`
- [ ] **This runs on the builder's machine** during the smoke script — not on Vercel
- [ ] Unit test with mocked CLI output

---

## Phase 3 — MCP tool extensions

### Task 5: Extend `arkage:register_agent_wallet` MCP tool

- [ ] Add optional input: `kind?: "circle-agent-wallet"` + `circleAgentWalletEmail?: string`
- [ ] If `kind === "circle-agent-wallet"`:
  - require `circleAgentWalletEmail` (Zod refinement)
  - skip the v1 Circle DCW provisioning path
  - skip the env-key staging step
  - store the email on the wallet row
- [ ] Audit-log the kind so the trail is clear
- [ ] Integration test: registering an external `0x...` address with `kind: "circle-agent-wallet"` + email → row created, no Circle DCW API call

### Task 6: Extend `arkage:bootstrap_user` MCP tool

- [ ] Add input: `agentTier2?: { mode: "circle-dcw" } | { mode: "circle-agent-wallet", address: Address, email: string }` (default: existing `circle-dcw` behavior for back-compat)
- [ ] If `mode === "circle-agent-wallet"`:
  - skip Circle DCW creation
  - skip Gateway-deposit step (Agent Wallets are auto-funded on testnet; pre-funded via `circle wallet fund` on mainnet)
  - register the wallet with `kind: "circle-agent-wallet"`
- [ ] Add a note in the response telling the builder how to deposit to Gateway via CLI: `circle gateway deposit --address <addr> --chain ARC-TESTNET --amount X`
- [ ] Integration test for both modes

---

## Phase 4 — x402 buyer path via Circle Agent Wallet

### Task 7: Route `arkage:pay_and_call` based on Tier 2 kind

- [ ] In `handlePayAndCall`, read the Tier 2 wallet's `kind`
- [ ] If `kind === "circle-agent-wallet"`:
  - **return an error envelope** explaining the buyer-side flow must run on the builder's machine (where the Circle CLI session lives). Provide the exact `circle services pay <url> --address <addr> --chain ARC-TESTNET --max-amount X --output json` command. We do **not** spawn `circle` from Vercel functions.
- [ ] If `kind === "circle-dcw-eoa"` or `"external-eoa"`: keep v1 behavior (`@circle-fin/x402-batching` GatewayClient via env-staged or DCW-derived key)
- [ ] Update integration test for `pay_and_call` to cover both branches

### Task 8: Document the buyer-side runtime contract

- [ ] In `docs/runbooks/circle-agent-wallet-onboarding.md`, write the section: "Running your agent locally with a Circle Agent Wallet"
- [ ] Include the exact command sequence: `circle wallet login`, `circle wallet list`, `circle services pay <ArkAge-x402-endpoint-url>`
- [ ] Note: ArkAge's `arkage:pay_and_call` MCP tool stays useful for non-Circle Tier 2 wallets; Circle-backed agents skip it entirely and call `circle services pay` directly

---

## Phase 5 — Console UI

### Task 9: New "Connect Circle Agent Wallet" step in the agent-creation flow

- [ ] In `src/app/console/agents/new/page.tsx`, add a tab: "Use Circle Agent Wallet"
- [ ] Tab shows three things:
  1. Install Circle CLI: `npm install -g @circle-fin/cli` (with copy button)
  2. Log in: `circle wallet login your@email.com` (with copy button)
  3. List wallets: `circle wallet list --type agent --chain ARC-TESTNET --output json` (with copy button)
- [ ] An input field: paste the wallet address
- [ ] An input field: paste the email used to log in (we store it, don't verify it server-side — the address is what's authoritative; the email is for the dashboard's "who controls this wallet" display)
- [ ] On submit, call `arkage:register_agent_wallet` with `kind: "circle-agent-wallet"`
- [ ] Show "Circle-backed" badge on the resulting agent profile

### Task 10: Agent profile surface

- [ ] On `/agents/<id>` (public) and `/console/agents/<id>` (builder), show:
  - The Tier 2 kind ("Circle Agent Wallet" / "Circle DCW EOA" / "External EOA")
  - For Circle-backed wallets: the controlling email (masked: `dev****@example.com`) — visible only to the builder, not public
  - A subtle Circle logo badge

---

## Phase 6 — Smoke test

### Task 11: `scripts/smoke-register-circle-agent.ts`

- [ ] Reads `--email`, `--chain` (default `ARC-TESTNET`) from CLI args
- [ ] Runs `circle wallet list --type agent --chain ARC-TESTNET --output json` locally
- [ ] Picks the first Agent Wallet from the list
- [ ] POSTs to MCP `arkage:register_agent_wallet` with `kind: "circle-agent-wallet"`
- [ ] Verifies the wallet row exists in DB
- [ ] Verifies `circle services pay` works against a registered ArkAge x402 endpoint (uses the smoke playbook's endpoint id 2)
- [ ] Asserts the response body contains the expected upstream content (Beverly Hills ZIP data per the smoke playbook)
- [ ] Asserts the wallet balance dropped by `pricePerCall` (the receipt)

### Task 12: End-to-end smoke against production Vercel

- [ ] Run Task 11 against the live `https://arkage-zeta.vercel.app`
- [ ] Capture the output in `docs/runbooks/circle-agent-wallet-onboarding.md` as a worked example
- [ ] If anything regresses vs v1's smoke playbook, **stop and triage** — don't paper over

---

## Phase 7 — Cleanup / drops

### Task 13: Remove the env-staged-key workaround for new wallets

- [ ] In `register-tier2-eoa` (the existing external-EOA path), add a deprecation banner in the response: "External-EOA Tier 2 is deprecated; prefer Circle Agent Wallets. See <runbook>."
- [ ] Do NOT remove the path itself yet — existing v1 agents still use it. v2 can delete.
- [ ] Delete `scripts/smoke-register-external-tier2.ts` once Task 12 passes — replaced by Task 11.

### Task 14: Update CLAUDE.md

- [ ] Add "Circle Agent Wallet" to the wallet-tier glossary (mark as the recommended Tier 2 going forward).
- [ ] Add a one-liner: "v1.5 Circle Agent Wallet onramp shipped — see `plan-e1-circle-agent-wallets-onramp.md`."
- [ ] Update the v1.5 backlog block: cross out Theme A. Add a callout that Theme C (ERC-7710 session keys) is **on ice** until Circle ships session keys.

### Task 15: Memory updates

- [ ] Update `project_arkage_design.md` with the v1.5 Theme A landing.
- [ ] Mark `reference_circle_agent_wallets_facts.md` as "verified production-aligned" — this is the doc that captures the real Circle surface, not Plan E's assumptions.

---

## Verification checklist (Plan E1 done)

- [ ] All tasks above marked complete in this file
- [ ] `npm test` green (including new circle-cli unit tests + integration tests)
- [ ] Production smoke passes end-to-end (Task 12) — a real Circle Agent Wallet successfully pays an ArkAge x402 endpoint
- [ ] `docs/runbooks/circle-agent-wallet-onboarding.md` complete with worked example
- [ ] CLAUDE.md updated
- [ ] Memory files updated
- [ ] Tag: `git tag plan-e1-complete`

---

## Out of scope (explicit)

- Programmatic Circle Agent Wallet provisioning (Circle hasn't shipped it — re-evaluate every release)
- Mainnet flows (Arc Mainnet not supported by Circle yet; the rest of ArkAge is testnet-only)
- ERC-7710 session keys (Plan E Theme C — on ice until Circle ships)
- Mirroring Circle's custom-policy DSL into `PolicyHook` (testnet has no Circle policies; mainnet deferred to Theme F)
- `agents.circle.com` listing (Plan E Theme D — needs Plan E1 done as prerequisite for on-chain anchor)

---

## Pre-flight executed 2026-05-12 — results

Ran the full pre-flight against `mbarraldevs@outlook.com` on the dev machine. See [`docs/runbooks/circle-agent-wallet-onboarding.md`](../../../docs/runbooks/circle-agent-wallet-onboarding.md) for command-by-command results.

**Working end-to-end**: install, login (mainnet + `--testnet`), SCA auto-provision on Arc Testnet (`0x86f97b...ee77`), faucet (20 USDC), `services inspect`, `services pay --estimate`, ERC-20 transfer (real on-chain tx), payment-payload signing.

**Confirmed**: ArkAge's `arkage-proxy/2` is fully Circle-CLI-compatible. The CLI signs a valid EIP-3009 `transferWithAuthorization` from the backing EOA against asset `0x3600...0000`, amount 1000 (= 0.001 USDC), payTo `0xdead...1234`, verifyingContract `0x0077777d...19b9`. arkage-proxy correctly forwards to Circle's facilitator.

**Blocker found — Circle CLI bug (NOT ArkAge code)**: `circle gateway deposit` on Arc Testnet always reports "balance is 0" regardless of actual on-chain state. Without a Gateway deposit, the facilitator rejects real payments with `Insufficient Gateway balance`. This is a Circle v0.0.1 bug. File with Circle DevRel; reference saved payload at `~/.circle-cli/payments/payment-2026-05-12T10-21-16-437Z.json`.

**Impact on this plan**: Tasks 1-11 are unaffected. **Task 12 (production smoke with a settled payment) is gated on Circle's fix.** When they patch, end-to-end flow works with zero ArkAge changes.

### New architectural finding — SCA + backing EOA pair

Agent Wallets are SCAs with an MPC-controlled **backing EOA**. The SCA is the user-facing identity (holds tokens, the `--address` arg to `services pay`). The backing EOA signs EIP-3009 authorizations.

**Implication for ArkAge data model**: when registering a Circle Agent Wallet as Tier 2, store **both** addresses. SCA is the primary `wallet.address`; backing EOA goes in a new column. Receipt-side `buyerWallet` extraction needs to handle both (the EIP-3009 `from` will be the EOA; ArkAge's UI should display the SCA).

**Migration update for Task 1**: add `circle_backing_eoa BYTEA NULL` column alongside `circle_agent_wallet_email TEXT NULL`. Populate at registration time via `circle gateway balance --address <sca> --output json` (the `backingEOA` field).

## Protocol compatibility — verified 2026-05-11

**`circle services pay <ArkAge-arkage-proxy-url>` will work end-to-end** with very high confidence. Researched against four official Circle protocol docs:

1. **Buyer quickstart** (`developers.circle.com/gateway/nanopayments/quickstarts/buyer`) shows the CLI's underlying API is `new GatewayClient({chain, privateKey}).pay(url)` from `@circle-fin/x402-batching` — the **exact same SDK ArkAge's `pay_and_call` already wraps**.
2. **Seller quickstart** (`developers.circle.com/gateway/nanopayments/quickstarts/seller`) shows the canonical seller setup is `createGatewayMiddleware({sellerAddress, facilitatorUrl: "https://gateway-api-testnet.circle.com"})` — **identical to ArkAge's `x402-seller-proxy.ts`** (same SDK, same facilitator URL, same `gateway.require("$0.01")` pricing pattern).
3. **Protocol concept** (`developers.circle.com/gateway/nanopayments/concepts/x402`): "The buyer does not need advance knowledge of the seller. The protocol is entirely discovery-based." Wire format = `402` + `PAYMENT-REQUIRED` header → buyer signs EIP-3009 `TransferWithAuthorization` → retries with `PAYMENT-SIGNATURE` → Circle facilitator batches. ArkAge's proxy already implements every step.
4. **Marketplace** (`agents.circle.com/services`) is **discovery/marketing only** — there is no allowlist, KYB, or registration prerequisite gating who `circle services pay` can pay. Sellers list themselves at the marketplace for visibility, not for payment compat.

**The v1 smoke (2026-05-10) already paid an ArkAge `arkage-proxy` endpoint via `GatewayClient.pay()` end-to-end on Arc Testnet.** `circle services pay` is the same call with a CLI wrapper.

## Open questions to capture during pre-flight (not blocking)

1. **`circle services pay`'s exact JSON response shape** — does it surface `txHash`, receipt ID, batched-settlement metadata? Pre-flight: capture one real response, document in the runbook. If sparse, ArkAge's receipt-side reconciliation falls back to the Circle facilitator webhook (already wired in v1 Plan D Task 9) — not a blocker.
2. **Exact JSON shape of `circle wallet list --type agent --output json`** — pre-flight: capture and document so Task 11's smoke script parses it correctly.
3. **`circle wallet sign typed-data` output shape** — useful for future off-chain ArkAge signing (evaluator authorizations etc.). Not blocking Plan E1.
4. **Cross-chain pay**: our smoke is same-chain (buyer + seller both on Arc Testnet). The fees doc mentions 0.5 bps for cross-chain; not relevant for v1.5 since Arc has no mainnet.

---

**Last updated:** 2026-05-11
**Status:** plan drafted · pre-flight + Tasks 1-15 ready for execution
