# Goldsky Pipeline Setup

The Mirror pipeline streams events from the **canonical** Arc Testnet
contracts (ERC-8183 + the three ERC-8004 registries) into Neon Postgres at
`indexer_raw.raw_chain_logs`. ArkAge's *own* 5 contracts are tracked
separately via Circle Contract Platform webhooks (see
`circle-webhook-setup.md`) — split is intentional: Goldsky covers high-
volume canonical infrastructure, Circle webhooks cover our typed event
shapes.

## Initial setup

1. Create a Goldsky account at <https://app.goldsky.com>.
2. Install the CLI and log in:
   ```bash
   npm install -g @goldskycom/cli
   goldsky login        # prompts for an API token from app.goldsky.com → Settings
   ```
3. Create the Postgres secret. **Goldsky uses a JDBC-shaped secret schema with
   broken-out fields** — *not* a single connection-string blob. Use the
   `DIRECT_DATABASE_URL` (not the pooled connection — pipeline write requires
   DDL rights to create the `indexer_raw` schema):
   ```bash
   DIRECT_URL="$(grep '^DIRECT_DATABASE_URL=' .env.local | cut -d= -f2-)"
   VALUE_JSON=$(python3 -c "
   import json, urllib.parse
   p = urllib.parse.urlparse('$DIRECT_URL')
   print(json.dumps({
       'type': 'jdbc',
       'protocol': 'postgres',
       'host': p.hostname,
       'port': p.port or 5432,
       'databaseName': p.path.lstrip('/'),
       'user': p.username,
       'password': p.password,
       'ssl': True,
   }))")
   goldsky secret create --name NEON_POSTGRES --value "$VALUE_JSON"
   ```
4. Apply the pipeline:
   ```bash
   goldsky pipeline apply indexer/goldsky/arkage-canonical.yaml
   ```

> **Naming gotcha** that bit me on first run: Goldsky uses **hyphenated chain
> slugs** in the docs (`arc-testnet`) but **underscored dataset names** in
> Mirror pipelines (`arc_testnet.raw_logs`). The dataset is also versioned —
> `version: 1.0.0` is required. The YAML in this directory has the right
> values; don't paraphrase the pinned dataset name.

## Verifying events flow

After 1-2 minutes, confirm rows are landing:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM indexer_raw.raw_chain_logs;"
```

Expected: count > 0 (assuming there is *any* activity on these contracts
on Arc Testnet — they may be quiet on a fresh network).

## Updating the pipeline

Edit `indexer/goldsky/arkage-canonical.yaml` and re-apply:

```bash
goldsky pipeline apply indexer/goldsky/arkage-canonical.yaml
```

## Inspecting

- Web: <https://app.goldsky.com> → Pipelines → arkage-canonical
- CLI: `goldsky pipeline logs arkage-canonical --tail`

## Rotating the Postgres secret

```bash
goldsky secret update NEON_POSTGRES <NEW_DATABASE_URL>
goldsky pipeline restart arkage-canonical
```

## Cost monitoring

Goldsky bills per event processed. Set a budget alert in the Goldsky
console.

## Fallback: Envio HyperIndex

The spec (CLAUDE.md, "Pre-implementation verification checklist") flags
Goldsky pricing for Arc Testnet as needing verification at implementation
time. If it comes back unfavorable, the documented fallback is **Envio
HyperIndex** — also Arc-supported. Decision criteria:

- **Stay with Goldsky if:** monthly testnet cost is under ~$50 and
  pipeline latency is < 30s p95.
- **Switch to Envio if:** Goldsky pricing exceeds budget OR the managed
  dataset for Arc Testnet doesn't exist yet (in that case, Envio's GraphQL-
  shaped indexer may have lower-friction onboarding).

The YAML in this directory is the only Goldsky-specific artifact; the
fallback would replace `arkage-canonical.yaml` with an Envio config.
