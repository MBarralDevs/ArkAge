import { defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Separate Vitest config for workflow integration tests.
 *
 * The `workflow()` plugin compiles `"use workflow"` and `"use step"`
 * directives so tests run the workflow body through the real runtime
 * in-process. Run with `npm run test:workflow`.
 *
 * The `@` alias must resolve to an absolute path because the workflow
 * plugin emits a `.workflow-vitest/steps.mjs` file that re-imports the
 * step modules — Vitest's resolver runs against that emitted file's
 * directory, so a relative-string alias would point at the wrong place.
 */

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [workflow()],
    test: {
        include: ["tests/workflow/**/*.test.ts"],
        testTimeout: 60_000,
        // The @workflow/vitest plugin emits `.workflow-vitest/steps.mjs` whose
        // externalized imports reference our source as `.js` paths
        // (rewriteTsExtensions=true). The dynamic import of that bundle is
        // marked `@vite-ignore`, so Node's native ESM loader resolves it.
        // Register tsx as a Node ESM loader so `.ts` source can be resolved
        // behind those `.js` import paths. In Vitest 4, execArgv is top-level.
        pool: "forks",
        execArgv: ["--import", "tsx"],
    },
    resolve: {
        alias: { "@": path.resolve(projectRoot, "src") },
    },
});
