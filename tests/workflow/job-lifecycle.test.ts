import { describe, it } from "vitest";

/**
 * jobLifecycle integration test — DEFERRED to Phase 14 smoke test.
 *
 * The @workflow/vitest plugin emits a self-contained `.workflow-vitest/steps.mjs`
 * bundle and dynamic-imports it via `@vite-ignore`, which means the bundle runs
 * outside Vitest's module loader. `vi.mock(...)` is a Vitest-resolver primitive,
 * so mocks defined here do not apply inside the bundled step bodies — those
 * still execute the real `readJob`, `db`, and Tier-3 wallet code paths.
 *
 * That makes a fully-mocked unit-style test infeasible without (a) running a
 * real Postgres + chain fixture or (b) replacing the world's step handler at
 * a deeper level than the public plugin API exposes. Plan B Phase 14 Task 33
 * exercises the four phases against a real Arc-Testnet job — which is the
 * right correctness gate for `jobLifecycle` end-to-end.
 *
 * Structural correctness of this workflow is covered by:
 *   - tsc strict (the workflow signature compiles against `awaitChainEventWithRescue`)
 *   - unit tests on the underlying helpers (self-rescue, hook-tokens,
 *     settlement-steps, recording-steps — under `tests/unit/`)
 *   - the Phase 14 smoke test (manual, against a posted Arc-Testnet job)
 */
describe.skip("jobLifecycle workflow (deferred to Phase 14 smoke test)", () => {
    it("placeholder", () => {});
});
