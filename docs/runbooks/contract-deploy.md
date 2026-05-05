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

## Step 1 — Provision Tier 3 wallets via the bootstrap script

Circle's Console UI no longer exposes wallet/wallet-set/entity-secret
creation — those are now SDK-only. We have a one-shot script that does
the whole thing.

### Architecture note: why a throwaway deployer EOA?

Circle Developer-Controlled Wallets use 2-of-2 MPC; the private key is
sharded between Circle and you and **cannot be exported**. Foundry's
`forge script --private-key` flow needs a raw key. So for the testnet
bootstrap we provision **4** wallets:

| Wallet | Implementation | Lifetime |
|---|---|---|
| `arkage:treasury` | Circle DCW EOA on `ARC-TESTNET` | Long-lived (runtime fees) |
| `arkage:validator` | Circle DCW EOA on `ARC-TESTNET` | Long-lived (Plan B runtime) |
| `arkage:gas-funder` | Circle DCW EOA on `ARC-TESTNET` | Long-lived (runtime gas top-ups) |
| `deployer` | **Throwaway** raw EOA, generated locally | One-shot — discarded after Plan A |

Mainnet uses Circle's deploy infrastructure instead — never raw keys.
See CLAUDE.md "PRIVATE_KEY is testnet-only".

### 1a. Make sure your API key is in `.env.local`

```dotenv
CIRCLE_API_KEY=…                  # from Circle Console → API & Client Keys
```

If you've never registered an entity secret on this Circle account before,
leave `CIRCLE_ENTITY_SECRET=` empty — the script will generate + register
one on first run.

### 1b. Run the bootstrap script

```bash
npm run bootstrap:tier3
```

The script:

1. Generates a 32-byte entity secret (if `CIRCLE_ENTITY_SECRET` is unset)
   and registers it with Circle. Recovery file lands in `.secrets/`
   (gitignored) — back this file up to a password manager.
2. Creates wallet set `arkage-testnet-system`.
3. Creates three EOA wallets on `ARC-TESTNET`: treasury, validator,
   gas-funder.
4. Generates a throwaway deployer EOA locally with viem.
5. Prints all four addresses + the deployer private key (+ entity secret
   on first run) ready to paste into `.env.local`.

### 1c. Paste the printed lines into `.env.local`

```dotenv
ARKAGE_TREASURY_WALLET_ADDRESS=0x…
ARKAGE_VALIDATOR_WALLET_ADDRESS=0x…
ARKAGE_GAS_FUNDER_WALLET_ADDRESS=0x…
PRIVATE_KEY=0x…
CIRCLE_ENTITY_SECRET=…            # only on first run
ARCSCAN_API_KEY=                  # only if Blockscout requires it; usually empty is fine
```

### 1d. Fund the deployer at the faucet

1. Open <https://faucet.circle.com>
2. Select **Arc Testnet**
3. Paste the **deployer address** (printed by the script as
   `# deployer address: 0x…`)
4. Request USDC — Arc gas is paid in USDC; a few USDC is plenty
   (deploy burns < 1 USDC of gas)

The 3 Circle DCWs do **not** need funding for Plan A — they're used by
later plans at runtime.

### 1e. Back up the recovery file off-machine

```bash
ls .secrets/
# recovery_file_<timestamp>.dat
```

Copy the contents into your password manager. Losing both the entity
secret and the recovery file = permanent Circle account lockout, no
recovery path.

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

## Re-provisioning Tier 3 wallets (rare)

If you need to re-create the 3 Circle DCWs (e.g. moving to a different
Circle account, or rotating wallets after a security incident), you can
re-run `npm run bootstrap:tier3`. Notes:

- If `CIRCLE_ENTITY_SECRET` is already set, the script reuses it and skips
  re-registration. To rotate the entity secret too, clear it from
  `.env.local` first — but be aware **rotating invalidates all existing
  wallets created under the old secret** (they become unsignable).
- The script always creates a fresh wallet set, so the wallets get new
  addresses. Update `.env.local` and re-deploy contracts if needed.
- If wallets already exist on the Circle side and you just want to re-list
  them rather than create new ones, use `client.listWallets({ walletSetId })`
  via a one-off script — not currently part of the bootstrap.
