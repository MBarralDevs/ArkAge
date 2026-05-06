import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  // Daily schedules are a Hobby-plan constraint (Hobby caps cron frequency
  // at once-per-day). The original spec target was every 5 min for both
  // reconcilers; bump to */5 * * * * once on Pro. Daily is sufficient for
  // testnet — the reconcilers are forward-looking and have no work to do
  // until Plan B fires real workflows / populates indexer_cursor.
  crons: [
    { path: "/api/cron/reconcile-stuck-workflows", schedule: "0 12 * * *" },
    { path: "/api/cron/reconcile-indexer-cursor", schedule: "0 13 * * *" },
  ],
};
