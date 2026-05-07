import { defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";

/**
 * Separate Vitest config for workflow integration tests.
 *
 * The `workflow()` plugin compiles `"use workflow"` and `"use step"`
 * directives so tests run the workflow body through the real runtime
 * in-process. Run with `npm run test:workflow`.
 *
 * The default `vitest.config.ts` deliberately does NOT include the
 * workflow plugin so unit tests don't pay the compilation cost.
 */

export default defineConfig({
    plugins: [workflow()],
    test: {
        include: ["tests/workflow/**/*.test.ts"],
        testTimeout: 60_000,
    },
    resolve: {
        alias: { "@": "/src" },
    },
});
