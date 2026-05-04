import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  crons: [
    { path: "/api/cron/reconcile-stuck-workflows", schedule: "*/5 * * * *" },
    { path: "/api/cron/reconcile-indexer-cursor", schedule: "*/5 * * * *" },
  ],
};
