# Circle Agent Wallet onboarding — runbook

> Used by Plan E1 (`docs/superpowers/plans/2026-05-11-plan-e1-circle-agent-wallets-onramp.md`) pre-flight + Task 12 smoke. Capture real CLI outputs here as we discover them — this file is the source of truth for the empirical shape of Circle's CLI on Arc Testnet.

## Versions verified

- Circle CLI: `0.0.1` (installed via `npm install -g @circle-fin/cli` 2026-05-11)
- Node: `22.20.0` (works despite docs saying `20.18.2+`)
- npm prefix: `~/.nvm/versions/node/v22.20.0` (no sudo needed for global install)

## Pre-flight findings (autonomous, no auth required)

These were verified by Claude without any user input or Circle login:

### 1. Arc Testnet is in the supported-chain list

`CIRCLE_ACCEPT_TERMS=1 circle blockchain list --output json` returns Arc Testnet at the end:

```json
{
  "blockchain": "ARC-TESTNET",
  "name": "Arc Testnet",
  "evmChainId": 5042002,
  "rpcUrl": "https://rpc.testnet.arc.network"
}
```

Chain code throughout the CLI is `ARC-TESTNET` (uppercase, hyphen). Matches our `CLAUDE.md`.

### 2. Agent Wallets are SCAs, not EOAs

`circle wallet create --help` says verbatim:

> "Create agent-controlled **SCA** wallets on all supported EVM chains. Note: agent wallet creation is capped at 5 wallets."

This contradicts the v1 LBC-1 spec assumption that Tier 2 must be an EOA for Gateway-compatible signing. Circle is handling the SCA → ECDSA-signature gap internally (likely via the MPC). Implication for ArkAge: our `wallet-router.ts` should record `kind: "circle-agent-wallet"` (SCA) without assuming EOA semantics downstream.

### 3. Gateway deposit explicitly supports `ARC-TESTNET`

`circle gateway deposit --help` lists `ARC-TESTNET` under the `direct` deposit method:

> "direct — On-chain deposit. Requires gas on source chain. Source chains supported: ETH, MATIC, ARB, AVAX, OP, BASE, UNI, ETH-SEPOLIA, BASE-SEPOLIA, ARB-SEPOLIA, AVAX-FUJI, OP-SEPOLIA, MATIC-AMOY, UNI-SEPOLIA, **ARC-TESTNET**. Destination: same chain as source."

The `eco` method (fast/no-gas) does NOT support Arc — it's Base-source-only routed to Polygon. For ArkAge agents, `--method direct --chain ARC-TESTNET` is what to use.

### 4. Agent wallets return Circle-side tx IDs, not tx hashes

From `circle wallet transfer --help` and `circle wallet execute --help`:

> "Minimal output (transaction hash for **local wallets**, transaction **ID** for **agent wallets**)"

Agent wallet operations are async: the CLI submits to Circle's tx infra, returns an ID, and Circle eventually broadcasts on-chain. ArkAge's receipt-side logic must resolve the tx ID to an on-chain tx hash via a follow-up query (presumably `circle transaction list` or via Circle's webhook).

### 5. `circle services inspect <ArkAge-arkage-proxy>` works without auth and validates compat

```bash
CIRCLE_ACCEPT_TERMS=1 circle services inspect \
  https://arkage-zeta.vercel.app/api/x402-proxy/2 --output json
```

Output:

```json
{
  "data": {
    "status": "payable",
    "httpStatus": 402,
    "url": "https://arkage-zeta.vercel.app/api/x402-proxy/2",
    "price": { "amount": "1000", "formatted": "$0.001 USDC" },
    "chains": ["eip155:5042002"],
    "scheme": "GatewayWalletBatched",
    "seller": "0xdead000000000000000000000000000000001234"
  }
}
```

This is **empirical proof** that Circle's CLI recognizes ArkAge's existing arkage-proxy as a fully-compatible x402 endpoint. `status: "payable"` means `circle services pay` against this URL will succeed once auth is set up.

### 6. Login provisions wallets on ETH/BASE/ARB/POLY/OP/AVAX/UNI mainnet+testnet — but NOT Arc Testnet

From `circle wallet login --help`:

> "First-time login for an email also registers that email as a Circle user and provisions one agent wallet on each EVM chain that Circle CLI supports (**ETH, BASE, ARB, POLY, OP, AVAX, UNI, and their testnets**)."

**Arc Testnet is conspicuously absent.** Will likely require an explicit `circle wallet create --chain ARC-TESTNET` post-login. Confirm during the auth phase below.

### 7. Wallet count cap

> "Note: agent wallet creation is capped at 5 wallets."

5 SCAs per email. Plan accordingly when planning multi-agent demos.

### 8. `circle services search` returns a public x402 service registry

Works without auth. Returns x402 endpoints registered globally (saw an `emc2ai.io` Bitquery endpoint on Base). Confirms the marketplace is a public registry, not a gated allowlist.

## Auth phase — needs human in the loop

Claude **cannot** complete `circle wallet login` because the OTP is delivered by email. The user must:

### Step A — kick off login (Claude or user can run this)

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet login YOUR-EMAIL@example.com \
  --type agent --init --output json
```

This emails an OTP to `YOUR-EMAIL@example.com` and returns a JSON object containing a `requestId`. Capture it.

### Step B — paste OTP (user)

Check email for a code like `B1X-123456`. Then:

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet login \
  --request <REQUEST-ID-FROM-STEP-A> \
  --otp <CODE-FROM-EMAIL> \
  --output json
```

Session is 7-day; stored in a local config dir (likely `~/.circle/` or `~/.config/circle/` — confirm post-login). Mainnet vs testnet sessions are **separate** (the login above gets the agent/testnet session).

### Step C — verify wallets provisioned

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet status --output json
CIRCLE_ACCEPT_TERMS=1 circle wallet list --type agent --chain ARC-TESTNET --output json
```

**If the second command returns an empty list**, Arc Testnet wasn't auto-provisioned (as the login prose hinted). Run:

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet create --output json
```

(There's no `--chain ARC-TESTNET` flag on create — it provisions on all supported chains. Arc Testnet should be included since it's in `blockchain list`.)

### Step D — verify auto-fund

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet balance --address <ADDR-FROM-STEP-C> --chain ARC-TESTNET --output json
```

Should show ~20 USDC per Circle docs. If empty, run `circle wallet fund --address <addr> --chain ARC-TESTNET --token usdc`.

## Smoke phase — once auth is set up

### Test 1 — Gateway deposit (prep for x402 pay)

```bash
CIRCLE_ACCEPT_TERMS=1 circle gateway deposit \
  --amount 0.1 \
  --address <ADDR> \
  --chain ARC-TESTNET \
  --method direct \
  --output json
```

### Test 2 — Inspect ArkAge proxy (we already did this; just confirm with a logged-in session it returns the same)

```bash
CIRCLE_ACCEPT_TERMS=1 circle services inspect \
  https://arkage-zeta.vercel.app/api/x402-proxy/2 --output json
```

### Test 3 — Pay ArkAge proxy (the load-bearing test)

```bash
CIRCLE_ACCEPT_TERMS=1 circle services pay \
  https://arkage-zeta.vercel.app/api/x402-proxy/2 \
  --address <ADDR> \
  --chain ARC-TESTNET \
  --max-amount 0.01 \
  --output json
```

Expected: same Beverly Hills ZIP data the v1 smoke returned. This is the proof point — a Circle Agent Wallet (SCA) paying an ArkAge `arkage-proxy` endpoint via `GatewayWalletBatched` on Arc Testnet, end-to-end.

### Test 4 — Call ArkAge AgentRegistry contract (Theme B preview)

```bash
CIRCLE_ACCEPT_TERMS=1 circle wallet execute \
  "registerAgent(address,bytes32,string)" \
  <OPERATOR-WALLET> 0x<POLICY-HASH> "ipfs://..." \
  --contract <ARKAGE_AGENT_REGISTRY_ADDRESS> \
  --address <ADDR> \
  --chain ARC-TESTNET \
  --estimate \
  --output json
```

`--estimate` first (no broadcast) to validate the ABI parse + gas estimate work. Capture the response shape.

## Open follow-ups for execution time

- Confirm Step C result: does `wallet list --chain ARC-TESTNET` return a wallet right after login, or does `wallet create` need to be run?
- Capture the **exact** JSON shape of `circle services pay` response — the Plan E1 buyer-path code branches on this.
- Confirm Step D: is the 20 USDC auto-fund a thing on Arc Testnet, or just Base/Sepolia? Empirically only Circle's main supported chains may auto-fund.
- Capture the location of the session file (look for new dirs under `~/.circle/`, `~/.config/`, or `~/.local/share/` after first login).
- Try `circle wallet sign typed-data` against an EIP-712 payload — needed for any custom signing flow in Theme E.

## Cleanup

To reset and try again:

```bash
circle wallet logout
rm -rf ~/.circle-cli ~/.circle  # actual session dirs
```

---

## Empirical pre-flight results (2026-05-12)

Ran the full flow against `mbarraldevs@outlook.com` on this WSL machine. Session lives at `~/.circle-cli/` (config + profiles) and `~/.circle/login-requests/` (in-flight OTP requests).

### What worked

| Step | Result | Evidence |
|---|---|---|
| `circle wallet login --type agent --init` (mainnet, default) | ✅ | Returned requestId; OTP delivered |
| `circle wallet login --type agent --testnet --init` | ✅ | **`--testnet` is undocumented in `login --help`** but referenced in error messages — required for Arc Testnet |
| Both sessions 6d 23h 59m TTL | ✅ | `circle wallet status --output json` |
| Auto-provision SCA on Arc Testnet | ✅ | Address: `0x86f97b7afc0b580d342e824084b79ae89993ee77`. **Contradicts the login prose** which omits Arc from auto-provisioned chains. |
| `circle wallet fund --token usdc --chain ARC-TESTNET` (faucet) | ✅ | 20 USDC delivered. **Reported by wallet balance as `decimals: 18, isNative: true`** (Arc representation quirk). |
| `circle services inspect <ArkAge-proxy-url>` | ✅ | Output: `{status: "payable", scheme: "GatewayWalletBatched", chains: ["eip155:5042002"], seller: "0xdead...1234", price: "$0.001 USDC"}` |
| `circle services pay --estimate <ArkAge-proxy-url>` | ✅ | Same payment shape parsed correctly |
| `circle wallet transfer` ERC-20 USDC SCA → backing EOA | ✅ | On-chain. txHash `0x7d8b074b7e93e7789ad0bec689fadf5957fbe3ff8485f2f2904fe73631d3f39d`, block 41817930, fee 0.0076 USDC (paid in native gas). |
| `circle wallet sign` (`message` + `typed-data` subcommands) | not tested in pre-flight — capture during execution | |
| `circle wallet execute --estimate` against ArkAge contracts | not tested in pre-flight — capture during Theme B | |
| Real `circle services pay` (no `--estimate`) | ⚠️ partial — **payment submitted, EIP-3009 signature generated, forwarded to ArkAge proxy** | But facilitator rejected: see below |

### Critical discovery — SCA + backing EOA architecture on Arc

`circle gateway balance` exposes a `backingEOA` field. The SCA `0x86f97b...ee77` is paired with EOA `0x3d6341f4af5ac687e4acb392bbe4745876ad6231`. Inspecting `payment-2026-05-12T10-21-16-437Z.json`:

```json
"authorization": {
  "from": "0x3d6341f4af5ac687e4acb392bbe4745876ad6231",  // backing EOA, NOT SCA
  "to": "0xdeAd000000000000000000000000000000001234",
  "value": "1000",
  ...
}
```

EIP-3009 `transferWithAuthorization` signatures are produced by the **backing EOA** (controlled by Circle's MPC), not the SCA. This is how Circle reconciles SCA wallets with Gateway's ecrecover requirement (LBC-1 in v1 spec).

**Implication for ArkAge**: when registering a Circle Agent Wallet as Tier 2, ArkAge stores the **SCA address** (the user-facing wallet identity, the `--address` arg to `circle services pay`, the address that holds tokens). Receipts will record the **backing EOA** as the buyer (because that's what signs the EIP-3009 authorization). The receipt-side `buyerWallet` field needs to either (a) accept both forms, or (b) cross-reference SCA → EOA at ingest time. Cleanest: track both addresses, treat SCA as primary identity, use EOA only for signature verification.

### Critical blocker — `circle gateway deposit` bug on Arc Testnet

`circle gateway deposit --amount X --address 0x86f97b... --chain ARC-TESTNET --method direct` consistently returns:

```
Error: Gateway deposit requires at least X USDC on ARC-TESTNET. Current USDC balance is 0.
```

Verified empirically that:
- SCA has 18 USDC at `0x3600000000000000000000000000000000000000` (Circle's own registered USDC contract for Arc Testnet — confirmed via `circle contract address usdc --chain ARC-TESTNET`)
- Backing EOA has 2 USDC at the same contract (transferred manually as a workaround attempt)
- `circle wallet balance` reports 18 USDC for the SCA correctly

So `circle gateway deposit`'s balance precondition check is consulting **neither** the SCA balance nor the backing EOA balance — it's stuck at 0 regardless. Looks like a Circle CLI v0.0.1 bug specific to Arc Testnet (likely the chain → USDC asset mapping the deposit-precheck uses is misconfigured for Arc).

**Without a deposit, real `circle services pay` fails at facilitator verification**: payment was submitted but Circle's facilitator returned `Insufficient Gateway balance`. The arkage-proxy correctly forwarded the rejection back; the protocol path is intact end-to-end.

**Action**: file an issue with Circle support / DevRel referencing the saved payment payload at `~/.circle-cli/payments/payment-2026-05-12T10-21-16-437Z.json`. Until Circle patches this, Plan E1 Task 12 (production smoke with a real settled payment) cannot complete. **All architectural work in Plan E1 (Tasks 1-11) is unaffected** — the bug is in Circle's CLI deposit-precheck, not in any ArkAge code path.

### Confirmed protocol compatibility

Despite the deposit blocker, the v1 smoke compatibility hypothesis is **empirically validated**:

- Circle CLI sees ArkAge's `arkage-proxy/2` as a fully valid x402 endpoint
- The payment scheme (`GatewayWalletBatched`), network (`eip155:5042002`), asset (`0x3600...`), seller (`0xdead...1234`), and price (`$0.001`) all parse correctly
- A valid EIP-3009 signature was produced and accepted by arkage-proxy's middleware (the 402-reject happened at Circle's facilitator side, not at our middleware)

When Circle fixes the deposit bug, the entire flow will work end-to-end with no ArkAge-side changes.

## Running your agent locally with a Circle Agent Wallet

This section captures the **buyer-side runtime contract** for an agent whose Tier 2 is a Circle Agent Wallet. Calling `arkage:pay_and_call` from the MCP server now returns a structured envelope (`code: "circle_agent_wallet_run_locally"`) telling the agent runtime to do the payment itself via Circle CLI. ArkAge does NOT spawn `circle` from Vercel functions — the CLI session lives on the builder's machine and that's where the agent must run.

### One-time setup (per builder)

```bash
# 1. Install Circle CLI (needs Node 20.18.2+)
npm install -g @circle-fin/cli

# 2. Log in. Two separate sessions: mainnet (default) and testnet.
#    For ArkAge on Arc Testnet you need the --testnet session.
CIRCLE_ACCEPT_TERMS=1 circle wallet login your@email.com --type agent --testnet

# 3. Find your auto-provisioned SCA on Arc Testnet.
CIRCLE_ACCEPT_TERMS=1 circle wallet list --type agent --chain ARC-TESTNET --output json

# 4. Find the backing EOA (needed when you register with ArkAge).
CIRCLE_ACCEPT_TERMS=1 circle gateway balance --address 0xYOUR_SCA --chain ARC-TESTNET --output json
# Look for the "backingEOA" field.

# 5. Faucet — Arc Testnet wallets need an explicit drip (auto-fund does NOT happen).
CIRCLE_ACCEPT_TERMS=1 circle wallet fund --address 0xYOUR_SCA --chain ARC-TESTNET --token usdc --output json
```

### Register the wallet with ArkAge (one-time, per agent)

Call `arkage:register_agent_wallet` with:

```json
{
  "kind": "circle-agent-wallet",
  "address": "0xYOUR_SCA",
  "circleAgentWalletEmail": "your@email.com",
  "circleBackingEoa": "0xYOUR_BACKING_EOA",
  "idempotencyKey": "<unique>"
}
```

Or — if this is your first agent for the builder identity — use `arkage:bootstrap_user` with `mode: "passkey-builder+circle-agent-wallet"` and a nested `circleAgentWallet` object.

The response from `bootstrap_user` includes `instructions[]` with the exact `circle gateway deposit` command tailored to your address — copy-paste it.

### Per-agent-call flow

Once registered, **do not call `arkage:pay_and_call`** for x402 endpoints. Instead, run on your machine:

```bash
CIRCLE_ACCEPT_TERMS=1 circle services pay https://arkage-zeta.vercel.app/api/x402-proxy/<endpointId> \
    --address 0xYOUR_SCA --chain ARC-TESTNET --max-amount 0.01 --output json
```

`circle services pay` handles the entire flow:
1. Issues the request, gets the 402 challenge
2. Generates a valid EIP-3009 `transferWithAuthorization` signature from your backing EOA
3. Retries with `PAYMENT-SIGNATURE` header
4. Circle's facilitator batches the settlement
5. Returns the seller's response body

For non-x402 ArkAge calls (post_job, submit_work, claim_refund, etc.), continue to use the corresponding MCP tools — the routing layer will dispatch correctly based on `tier2Kind = "circle-agent-wallet"` recorded on your wallet row.

### Current limitation (2026-05-12)

`circle gateway deposit` on Arc Testnet is **broken** in Circle CLI v0.0.1 — it reports "balance is 0" regardless of on-chain state, which prevents the Gateway pre-deposit step. Without that, real `circle services pay` fails at the facilitator with `Insufficient Gateway balance`. Bug filed with Circle. Once they patch, the flow above works end-to-end with no ArkAge-side changes.

### Updated answers to Plan E1 open questions

1. **`circle services pay` JSON shape** — see saved payload at `~/.circle-cli/payments/payment-<ts>.json`. Top-level keys: `timestamp, url, method, address, blockchain, payment, paymentHeader (base64), paymentPayload (decoded)`.
2. **`circle wallet list` JSON shape** — `{data: {wallets: [{type, address, blockchain, createDate}]}}`. Filterable by `--type agent|local` and `--chain`.
3. **Session storage** — `~/.circle-cli/{config.json, terms.json, profiles/}` + `~/.circle/login-requests/`.
4. **Auto-fund on Arc Testnet** — does NOT happen automatically. Requires explicit `circle wallet fund --token usdc --chain ARC-TESTNET`. Drip is 20 USDC. **Docs claim auto-fund; reality contradicts.**
5. **`--testnet` flag on login** — undocumented in `login --help`; required for testnet session.

