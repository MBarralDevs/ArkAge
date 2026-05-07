import { describe, it } from "vitest";

/**
 * llmEvaluatorAgent integration test — DEFERRED to Phase 14 smoke test.
 *
 * Same `@workflow/vitest`-mock incompatibility as `job-lifecycle.test.ts`:
 * the plugin emits `.workflow-vitest/steps.mjs` and dynamic-imports it via
 * `@vite-ignore`, so step bodies execute outside Vitest's resolver and
 * `vi.mock(...)` does not intercept the bundled `DurableAgent`,
 * `readJob`, `db`, or settlement calls.
 *
 * End-to-end correctness is exercised in Plan B Phase 14 Task 33 against a
 * real Arc-Testnet job with the AI Gateway live. Structural correctness is
 * covered by `tsc --noEmit` and unit tests on:
 *   - `evaluator-prompts` (prompt version + tier→model mapping)
 *   - `evidence-store` (canonical JSON + keccak256 hash)
 *   - `settlement-steps` (Tier-3 signing path)
 */
describe.skip("llmEvaluatorAgent (deferred to Phase 14 smoke test)", () => {
    it("placeholder", () => {});
});
