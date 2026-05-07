import { describe, it, expect } from "vitest";
import { decideResolution } from "@/workflows/x402-dispute-flow";

/**
 * Pure-function unit test for the dispute resolution decision matrix.
 *
 * The workflow body itself (loadReceipt + reattemptCall + applyResolution
 * + recordWorkflow*) is deferred to the Phase 14 smoke test for the same
 * `@workflow/vitest`-mock incompatibility as the other workflows; the
 * decision logic is the load-bearing correctness piece and is unit-testable
 * in isolation.
 */
describe("x402 dispute resolution", () => {
    it("refunds on persistent 5xx (original + reattempt both 5xx)", () => {
        expect(
            decideResolution({
                originalStatus: 502,
                reattemptStatus: 502,
                reattemptOk: false,
            }),
        ).toBe("refund");
    });

    it("refunds on timeout codes (408/504)", () => {
        expect(
            decideResolution({
                originalStatus: 408,
                reattemptStatus: 200,
                reattemptOk: true,
            }),
        ).toBe("refund");
        expect(
            decideResolution({
                originalStatus: 504,
                reattemptStatus: 500,
                reattemptOk: false,
            }),
        ).toBe("refund");
    });

    it("declines refund on 2xx that still works on reattempt", () => {
        expect(
            decideResolution({
                originalStatus: 200,
                reattemptStatus: 200,
                reattemptOk: true,
            }),
        ).toBe("no_refund");
    });

    it("escalates to manual_review when ambiguous (4xx other than timeout)", () => {
        expect(
            decideResolution({
                originalStatus: 404,
                reattemptStatus: 200,
                reattemptOk: true,
            }),
        ).toBe("manual_review");
    });

    it("escalates to manual_review when original status is unknown", () => {
        expect(
            decideResolution({
                originalStatus: null,
                reattemptStatus: 200,
                reattemptOk: true,
            }),
        ).toBe("manual_review");
    });

    it("escalates to manual_review on 5xx that recovers (transient)", () => {
        expect(
            decideResolution({
                originalStatus: 500,
                reattemptStatus: 200,
                reattemptOk: true,
            }),
        ).toBe("manual_review");
    });
});
