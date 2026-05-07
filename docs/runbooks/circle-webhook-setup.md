# Circle Contract Platform Webhook Setup

ArkAge's 5 deployed contracts are **not** indexed by Goldsky (which
handles the canonical contracts) — instead, Circle Contract Platform
sends signed webhooks to our Vercel deployment for every event our
contracts emit. This runbook covers the one-time setup and ongoing
operations.

## One-time setup per environment

### 1. Import the 5 contracts in Circle Console

For each of our deployed contracts, take the **address** from
`contracts/deployments/arc-testnet.json` and the **ABI** from
`contracts/out/<Contract>.sol/<Contract>.json` (Foundry build output).

In Circle Console → **Smart Contract Platform** → **Contracts**, click
**Import contract** and fill in:

| # | Name | Address | Chain |
|---|---|---|---|
| 1 | AgentRegistry | from artifact | Arc Testnet |
| 2 | PolicyHook | from artifact | Arc Testnet |
| 3 | ReputationHook | from artifact | Arc Testnet |
| 4 | EvaluatorFeeHook | from artifact | Arc Testnet |
| 5 | HookComposer | from artifact | Arc Testnet |

Paste the corresponding ABI for each.

### 2. Create event monitors

For each of the 5 imported contracts, create an **Event Monitor**
subscribed to **all** events. (Filtering is handled at the receiver in
`src/workers/ingest-circle-event.ts`.)

### 3. Create a webhook endpoint

In Circle Console → **Webhooks**:

1. Click **Create webhook**
2. **Category**: pick **Smart Contract Platform**
3. **Endpoint URL**: `https://<your-vercel-deployment-url>/api/webhooks/circle`
   - For local development, use a tunnel (ngrok / cloudflared) and update
     the URL when promoting to production.

> **No shared secret needed.** Circle Web3 Services webhooks (Smart
> Contract Platform included) are signed with **ECDSA-SHA256 + a public
> key fetched from Circle's API**. The receiver reads `X-Circle-Key-Id`,
> calls `GET /v2/notifications/publicKey/{keyId}` (Bearer auth via
> `CIRCLE_API_KEY`), caches the key, then verifies. There is no shared
> secret to copy from the console — `CIRCLE_API_KEY` alone is enough.

4. **Subscribe** the webhook to all event monitors created in step 2.

### 4. Activate the webhook

Circle activates the webhook by sending a `webhooks.test` notification
(an ECDSA-signed POST). If the receiver verifies + returns 200, the
webhook flips to **Active**. If it fails (e.g. signature mismatch,
public-key fetch error), the console will show **NON 2XX**; click
**Retry connection** after fixing the issue server-side.

### 4. Verify with the smoke test

After setup, trigger a test write to AgentRegistry from the deployer
(testnet only — uses the throwaway deploy key):

```bash
cast send "$ARKAGE_AGENT_REGISTRY_ADDRESS" \
  "registerAgent(uint256,address,bytes32,uint128,uint64)" \
  1 \
  0xb43CbdA374e3CD2a3d67827683F81462BaCF703b \
  0x0000000000000000000000000000000000000000000000000000000000000001 \
  1000000 \
  100000 \
  --rpc-url $ARC_TESTNET_RPC_HTTP \
  --private-key $PRIVATE_KEY
```

> Note: the call will revert because the deployer doesn't own ERC-8004
> agent ID 1, but the **revert** is itself an emitted log Circle
> forwards. For a successful path, run the smoke test described in
> Task 33 once Plan B's MCP server is deployed.

Then check the `audit_log` table for an `actorId='circle-webhook'` row:

```bash
psql "$DATABASE_URL" -c \
  "SELECT action, target_id, created_at FROM audit_log
   WHERE actor_id='circle-webhook' ORDER BY created_at DESC LIMIT 5;"
```

## Rotating the webhook secret

When you suspect compromise (or as part of routine quarterly hygiene):

1. Circle Console → **Webhooks** → select webhook → **Rotate secret**
2. Update `CIRCLE_WEBHOOK_SECRET` in Vercel env vars (production + preview)
3. Redeploy: `vercel --prod`
4. Confirm by triggering the smoke test above and watching for a 200 in
   Circle Console's webhook delivery log.

## Re-importing a contract after redeployment

If a contract is redeployed (new salt, new address):

1. Update `contracts/deployments/arc-testnet.json` and `.env.local`
2. In Circle Console, **delete** the old contract import + event monitor
3. Re-import the new address with the new ABI
4. Re-attach the existing webhook to the new event monitor

The webhook URL and secret stay the same — only the source contract
changes.
