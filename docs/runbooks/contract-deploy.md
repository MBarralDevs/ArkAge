# Runbook: Deploying ArkAge contracts to Arc Testnet

End-to-end procedure for Plan A Tasks 25 + 26. Run when bootstrapping a new
environment, redeploying after a contract change, or recovering from a
deploy that needs to be re-run from scratch.

> **Mainnet warning.** This runbook is **testnet-only**. The `PRIVATE_KEY`
> export step is acceptable for testnet but **must not be used for mainnet**.
> For mainnet, use Circle's deploy infra or a hardware-signed flow — never
> a raw key in env vars.

---

## Prerequisites

- Foundry installed (`forge --version`)
- Circle Console account: <https://console.circle.com>
- Arc Testnet faucet access: <https://faucet.circle.com>
- Local clone of `MBarralDevs/ArkAge`, on the branch you want to deploy from
- All 74 contract tests green (`cd contracts && forge test`)

---

## Step 1 — Provision Tier 3 wallets in Circle Console

You need three Developer-Controlled Wallets (DCW) in **EOA mode** on
Arc Testnet. EOA mode is mandatory (LBC-1 in spec §5) — Circle Gateway
nanopayments verify via `ecrecover`, which doesn't work for smart-account
wallets.

### 1a. One-time Circle Console setup

The first time you create developer-controlled wallets, Circle requires you
to register an **entity secret**:

1. Sign in at <https://console.circle.com>
2. Top-right profile menu → **API & Client Keys** (or sidebar **Configurator
   → Entity Secret**, depending on the console version)
3. Click **Generate Entity Secret** → save the resulting hex string locally
   (you'll never see it again)
4. Click **Encrypt Entity Secret** → upload the public key Circle provides,
   get back a **ciphertext**
5. Click **Register Ciphertext** → paste the ciphertext

You only do this once per Circle account.

### 1b. Create a Wallet Set

Wallets live inside a **Wallet Set** — the logical grouping. From the
console:

1. Sidebar **Developer Services → Wallets** (or top-level **Wallets** in
   newer UIs)
2. Click **Create Wallet Set**
3. Type: **Developer-Controlled**
4. Name: `arkage-testnet-system`
5. Save

### 1c. Create the three wallets

Inside the wallet set, click **Create Wallet** three times:

| Name | Blockchain | Account type |
|------|------------|--------------|
| `arkage:treasury`   | Arc Testnet (`ARC-SEPOLIA` / chain id 5042002) | EOA |
| `arkage:validator`  | Arc Testnet | EOA |
| `arkage:gas-funder` | Arc Testnet | EOA |

> **Console name confusion:** depending on UI version, Arc Testnet may show
> as `ARC-SEPOLIA`, `ARC-TESTNET`, or `Arc (Testnet)`. The chain id is the
> source of truth — `5042002` (decimal) / `0x4CEF52` (hex).

Copy each wallet's address.

### 1d. Fund the gas-funder

1. Open <https://faucet.circle.com>
2. Select **Arc Testnet**
3. Paste the gas-funder address
4. Request USDC (Arc gas is paid in USDC — the faucet handles this)

A few USDC is plenty — the deploy itself burns < 1 USDC of gas.

### 1e. Export the gas-funder private key

In Circle Console, open the gas-funder wallet → **Settings** or
**Advanced** → **Export Private Key** → copy the hex value.

> If your console version doesn't surface a one-click export, you can derive
> it from the entity secret + wallet metadata via the Circle SDK. See the
> "Programmatic export" section at the bottom of this runbook.

### 1f. Populate `.env.local` (do NOT commit)

```dotenv
ARKAGE_TREASURY_WALLET_ADDRESS=0x…
ARKAGE_VALIDATOR_WALLET_ADDRESS=0x…
ARKAGE_GAS_FUNDER_WALLET_ADDRESS=0x…
PRIVATE_KEY=0x…
ARCSCAN_API_KEY=                  # only if Blockscout requires it; usually empty is fine
```

---

## Step 2 — Pre-flight: verify canonical Arc addresses are alive

The 4 canonical addresses pinned in `contracts/script/Deploy.s.sol` came
from Arc tutorial pages and CLAUDE.md flags them as needing verification.
Run this from anywhere with Foundry installed:

```bash
for addr in \
  0x0747EEf0706327138c69792bF28Cd525089e4583 \
  0x8004A818BFB912233c491871b3d84c89A494BD9e \
  0x8004B663056A597Dffe9eCcC1965A193B7388713 \
  0x3600000000000000000000000000000000000000; do
  size=$(cast code "$addr" --rpc-url https://rpc.testnet.arc.network | wc -c)
  echo "$addr -> $size bytes"
done
```

Expected: all four print non-trivial byte counts (anything > 4 bytes —
empty bytecode is `0x` which is 4 chars including the prefix). If any
prints `2`, that address has been wiped → stop and update Deploy.s.sol
before broadcasting.

---

## Step 3 — Broadcast the deploy

From the repo root:

```bash
# Pull the treasury value out of .env.local for forge to see
export ARKAGE_TREASURY_WALLET_ADDRESS="$(grep '^ARKAGE_TREASURY_WALLET_ADDRESS=' .env.local | cut -d= -f2)"
export PRIVATE_KEY="$(grep '^PRIVATE_KEY=' .env.local | cut -d= -f2)"

cd contracts && \
  forge script script/Deploy.s.sol \
    --rpc-url arc_testnet \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    --verify \
    --verifier blockscout \
    --verifier-url https://testnet.arcscan.app/api \
    -vvv
```

### What you'll see

The script logs five addresses in dependency order, then confirms
`trustedCaller` was wired on the three hooks, then writes
`contracts/deployments/arc-testnet.json`:

```
=== ArkAge v1 deploy ===
chainId               5042002
deployer              0x…
treasury              0x…
…
AgentRegistry         0x…
PolicyHook            0x…
ReputationHook        0x…
EvaluatorFeeHook      0x…
HookComposer          0x…
trustedCaller wired on policyHook / reputationHook / feeHook
Wrote deployment artifact: deployments/arc-testnet.json
```

### If the deploy fails partway through

Each contract is a separate transaction, so a mid-flight failure leaves
some contracts deployed and others not. **Do not "fix and re-run" —** the
CREATE2 salt is identical, so addresses already deployed can't be
re-deployed. Either:

1. Change the SALT in `Deploy.s.sol` to bump the deploy generation
   (`keccak256("arkage-v1-2026-05-02-r2")`) and re-run, OR
2. Use the per-contract recovery path documented in
   `docs/runbooks/contract-deploy-recovery.md` *(written when first needed)*.

---

## Step 4 — Verify on Arcscan

For each of the 5 deployed addresses, open
`https://testnet.arcscan.app/address/<address>` and confirm:

- [ ] Code tab shows verified source
- [ ] Read tab exposes the public getters
- [ ] Constructor args appear correct

If a contract isn't auto-verified by Blockscout, manually upload using:

```bash
forge verify-contract <address> <ContractName> \
  --chain 5042002 \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api
```

---

## Step 5 — Pin addresses everywhere

The deploy script already wrote `contracts/deployments/arc-testnet.json`.
Copy the 5 ArkAge addresses into `.env.local`:

```dotenv
ARKAGE_AGENT_REGISTRY_ADDRESS=0x…
ARKAGE_POLICY_HOOK_ADDRESS=0x…
ARKAGE_REPUTATION_HOOK_ADDRESS=0x…
ARKAGE_EVALUATOR_FEE_HOOK_ADDRESS=0x…
ARKAGE_HOOK_COMPOSER_ADDRESS=0x…
```

Mirror them in Vercel:

```bash
vercel env add ARKAGE_AGENT_REGISTRY_ADDRESS production preview
# (repeat for each)
```

---

## Step 6 — Commit the deployment artifact

```bash
git add contracts/deployments/arc-testnet.json
git commit -m "feat(contracts): deploy v1 contracts to Arc Testnet

Pinned addresses recorded in deployments/arc-testnet.json.
All 5 contracts verified on testnet.arcscan.app."
git tag plan-a-task-26-complete
git push origin main --tags
```

---

## Programmatic export (fallback for Step 1e)

If the Circle Console UI doesn't offer a one-click "export private key"
button for DCW EOA wallets, you can fetch it via the Circle SDK using your
entity secret:

```ts
// scripts/export-wallet-pk.ts (run with: npx tsx scripts/export-wallet-pk.ts)
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
});

const { data } = await client.getWalletKey({
  id: process.env.GAS_FUNDER_WALLET_ID!, // from Circle Console
});

console.log(data?.privateKey);
```

This script is **not** committed to the repo — write it locally in a
gitignored scratch directory if you need it. Delete after use.
