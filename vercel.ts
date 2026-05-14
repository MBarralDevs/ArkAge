import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  // The reconcilers run daily — they're forward-looking probes with no
  // tight latency requirement. `normalize-goldsky` is different: it's the
  // delivery path for canonical-contract events into the app DB and into
  // workflow `resumeHook` calls. Every-minute keeps the activity feed
  // near-realtime; requires Pro plan (Hobby caps cron frequency at daily).
  crons: [
    { path: "/api/cron/normalize-goldsky", schedule: "*/1 * * * *" },
    { path: "/api/cron/reconcile-stuck-workflows", schedule: "0 12 * * *" },
    { path: "/api/cron/reconcile-indexer-cursor", schedule: "0 13 * * *" },
    { path: "/api/cron/reconcile-treasury", schedule: "0 14 * * *" },
  ],
};
