import { describe, it, expect } from "vitest";
import * as mod from "@/workflows/lib/self-rescue";

/**
 * Smoke test that the module compiles and exports the helper. Full
 * behavioral tests for the self-rescue race require a workflow runtime
 * harness — those live in tests/workflow/ and run via the
 * @workflow/vitest plugin (npm run test:workflow).
 */
describe("self-rescue module", () => {
    it("exports awaitChainEventWithRescue", () => {
        expect(typeof mod.awaitChainEventWithRescue).toBe("function");
    });
});
