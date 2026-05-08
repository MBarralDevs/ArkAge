import type { NextConfig } from "next";
// Per the canonical Next.js setup at workflow/docs/getting-started/next.mdx,
// import withWorkflow from "workflow/next". The `@workflow/next` package
// re-exports it but the docs use the shorter form.
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // pg-listen pulls in pg-format which uses runtime require() patterns
  // Turbopack can't statically resolve. Mark these server-only deps as
  // external so they're loaded via Node at runtime.
  serverExternalPackages: ["pg-listen", "pg", "pg-format"],
};

// withWorkflow injects the Vercel Workflow DevKit handler glue at build time.
// Every workflow imported by /api/workflows/[...slug] route gets registered
// with the runtime through this wrapper.
export default withWorkflow(nextConfig);
