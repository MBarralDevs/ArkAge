import type { NextConfig } from "next";
// Per the canonical Next.js setup at workflow/docs/getting-started/next.mdx,
// import withWorkflow from "workflow/next". The `@workflow/next` package
// re-exports it but the docs use the shorter form.
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
};

// withWorkflow injects the Vercel Workflow DevKit handler glue at build time.
// Every workflow imported by /api/workflows/[...slug] route gets registered
// with the runtime through this wrapper.
export default withWorkflow(nextConfig);
