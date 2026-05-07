import { z } from "zod";

const envSchema = z.object({
  // Network — Arc Testnet
  ARC_TESTNET_RPC_HTTP: z.string().url(),
  ARC_TESTNET_RPC_WS: z.string().url(),

  // Database (Neon Postgres)
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url().optional(),

  // Circle (DCW + webhook)
  // Note: no CIRCLE_WEBHOOK_SECRET — Circle Web3 Services webhooks are
  // signed with ECDSA against a public key fetched via CIRCLE_API_KEY,
  // not HMAC against a shared secret. See src/lib/circle-webhook-verify.ts.
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_SECRET: z.string().min(1),

  // Goldsky (optional in dev — not required until Plan A Task 27)
  GOLDSKY_PROJECT_ID: z.string().min(1).optional(),

  // Deployed contract addresses (set after Plan A Task 26)
  ARKAGE_HOOK_COMPOSER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_REPUTATION_HOOK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_POLICY_HOOK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_EVALUATOR_FEE_HOOK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_AGENT_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  // Tier 3 system wallets (set after Circle DCW provisioning, Plan A Task 25)
  ARKAGE_VALIDATOR_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_TREASURY_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARKAGE_GAS_FUNDER_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  // Cron auth (Vercel Cron Bearer token; generate with `openssl rand -hex 32`)
  CRON_SECRET: z.string().min(16),

  // App
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally fail-fast at module load: misconfiguration in production
  // should crash the process immediately rather than surface a silent
  // downstream error. The fieldErrors log is enough to debug locally.
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
