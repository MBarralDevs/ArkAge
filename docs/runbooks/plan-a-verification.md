# Plan A — Final verification checklist

Run through this sequentially before tagging `plan-a-complete`. Any
item that fails is a blocker — Plan B builds on top of these
foundations and assumes they're all live.

---

## 1. All tests green

```bash
# TypeScript / Postgres / Vitest layer
npm test

# Solidity / Foundry layer
cd contracts && forge test && cd -
```

**Expected:**
- Vitest: 19/19 pass across 6 suites (sanity, chain, circle-webhook-verify,
  reconcile-stuck-workflows, webhook-route, etc.)
- Foundry: 74/74 pass across 7 suites

If either count is lower than expected, stop and investigate before
proceeding. Coverage targets (Plan A spec): ≥95% line, ≥85% branch on
contracts; we currently sit at ~98% line / ~96% branch.

---

## 2. Postgres schema fully migrated

```bash
psql "$DATABASE_URL" -c "\dt"
```

**Expected** — these 18 tables (spec §7) all present:

- builders
- wallets
- agents
- agent_metadata
- policies
- jobs
- job_events
- job_evaluations
- reputation_feedback
- reputation_validations
- x402_endpoints
- x402_sessions
- x402_receipts
- x402_disputes
- treasury_movements
- workflow_runs
- indexer_cursor
- audit_log

Plus the Goldsky raw-logs schema:

```bash
psql "$DATABASE_URL" -c "\dt indexer_raw.*"
```

**Expected:** `indexer_raw.raw_chain_logs` (created by Goldsky on first
pipeline apply — may be empty if there's no canonical-contract activity
yet).

---

## 3. All 5 contracts deployed and verified

```bash
cat contracts/deployments/arc-testnet.json
```

**Expected:** `chainId: 5042002`, `salt`, `deployer`, and 5 valid
`0x…` addresses under `contracts:` (none `0x0`).

Then for each address, open the corresponding Arcscan page and confirm
the **"Contract verified"** badge:

- AgentRegistry: <https://testnet.arcscan.app/address/0x06f606686016E5D015A4f0236307524E86E013e4>
- PolicyHook: <https://testnet.arcscan.app/address/0x7bd5A152EA8Ab239487B503fb8596A8Cfc504388>
- ReputationHook: <https://testnet.arcscan.app/address/0x5E7672790d0E85Fc2fcFd75F2922958F7F36B398>
- EvaluatorFeeHook: <https://testnet.arcscan.app/address/0x8d97E0d4ba64f7aBbb12265456Ad4662F54238AF>
- HookComposer: <https://testnet.arcscan.app/address/0xd1F983efC1374774B144B5299eD2B49D7720359b>

Programmatic spot-check (no browser needed):

```bash
curl -s "https://testnet.arcscan.app/api?module=contract&action=getabi&address=0x06f606686016E5D015A4f0236307524E86E013e4" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("verified" if d.get("message")=="OK" and d.get("result","").startswith("[") else "NOT verified")'
```

**Expected:** `verified` for each of the 5 addresses.

---

## 4. trustedCaller wiring is correct on all 3 hooks

```bash
RPC=https://rpc.testnet.arc.network
COMPOSER=0xd1F983efC1374774B144B5299eD2B49D7720359b
for hook in 0x7bd5A152EA8Ab239487B503fb8596A8Cfc504388 \
            0x5E7672790d0E85Fc2fcFd75F2922958F7F36B398 \
            0x8d97E0d4ba64f7aBbb12265456Ad4662F54238AF; do
  result=$(cast call "$hook" 'trustedCaller()(address)' --rpc-url "$RPC")
  echo "$hook -> $result"
done
```

**Expected:** all three return `0xd1F983efC1374774B144B5299eD2B49D7720359b`
(the HookComposer). This is the post-deploy wiring that makes the
hooks accept calls from the composer in production.

---

## 5. Goldsky pipeline is running

```bash
goldsky pipeline status arkage-canonical
```

**Expected:** status is `RUNNING`. If `FAILED`, check
`goldsky pipeline logs arkage-canonical --tail` and consult
`docs/runbooks/goldsky-pipeline-setup.md`.

---

## 6. Circle Contract Platform webhook is configured

In Circle Console (<https://console.circle.com>):

- [ ] Smart Contract Platform → Contracts: all 5 ArkAge contracts imported
  (AgentRegistry, PolicyHook, ReputationHook, EvaluatorFeeHook, HookComposer)
- [ ] Each imported contract has an **Event Monitor** subscribed to all events
- [ ] Webhooks tab: a webhook endpoint exists with URL pointing at
  `https://<your-vercel-deployment>/api/webhooks/circle`
- [ ] The webhook is subscribed to all 5 contracts' event monitors
- [ ] `CIRCLE_WEBHOOK_SECRET` is set in Vercel env (production + preview)
- [ ] Circle Console → Webhooks → Delivery History shows recent successful
  (200) deliveries (or, if there's been no on-chain activity yet, an empty
  list — that's fine pre-Plan-B)

---

## 7. Vercel cron jobs are registered

```bash
vercel inspect --crons
```

**Expected:** 2 cron jobs listed:

- `/api/cron/reconcile-stuck-workflows` — `*/5 * * * *`
- `/api/cron/reconcile-indexer-cursor` — `*/5 * * * *`

`CRON_SECRET` must be set in Vercel env (production + preview) for
these to authenticate. After deployment, check the Vercel dashboard's
Cron tab for at least one successful invocation.

---

## 8. Tier 3 wallets are tracked in Circle

In Circle Console, confirm the wallet set `arkage-testnet-system`
exists with three EOA wallets on `ARC-TESTNET`:

- `arkage:treasury` → `0xb7da8d276fa0f8ea9ad2c16af19bddc03c629e3c`
- `arkage:validator` → `0x07db1e1256920fc41995bcfca15cb6dd38a47bb1`
- `arkage:gas-funder` → `0x8b59cd0195e58fe88c0106b8f34dffdd5baf7a7e`

The throwaway deployer EOA (`0xb43CbdA374e3CD2a3d67827683F81462BaCF703b`)
is **not** in Circle by design — it's a one-shot raw EOA for the
bootstrap broadcast and can be ignored from here on.

---

## 9. Recovery file + entity secret are backed up off-machine

- [ ] `CIRCLE_ENTITY_SECRET` saved to a password manager outside this repo
- [ ] Contents of `.secrets/recovery_file_*.dat` saved to a password manager

Without both, losing the dev machine = permanently unsignable Circle wallets.
There is no Circle-side recovery.

---

## 10. Final commit + tag

If every item above is ✅, tag the milestone:

```bash
git tag plan-a-complete
git push origin main --tags
```

🎉 **Plan A complete.** Foundational data layer is live: contracts
deployed and verified, schema migrated, indexer streaming canonical
events, Circle webhooks streaming our own contract events, crons
running every 5 minutes to flag stuck workflows and indexer lag.
Ready to start Plan B (MCP server + workflows + LLM evaluator).
