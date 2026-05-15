import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  // Daily schedules are a Hobby-plan constraint (Hobby caps cron
  // frequency at once-per-day). `normalize-goldsky` needs near-realtime
  // cadence, which Hobby can't express here — so it is NOT a Vercel cron.
  // It runs from an external scheduler (.github/workflows/normalize-goldsky.yml)
  // that hits /api/cron/normalize-goldsky with the CRON_SECRET bearer.
  // Move it back into this array (e.g. */5 * * * *) if the project
  // upgrades to Pro.
  crons: [
    { path: "/api/cron/reconcile-stuck-workflows", schedule: "0 12 * * *" },
    { path: "/api/cron/reconcile-indexer-cursor", schedule: "0 13 * * *" },
    { path: "/api/cron/reconcile-treasury", schedule: "0 14 * * *" },
  ],
};
