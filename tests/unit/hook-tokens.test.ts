import { describe, it, expect } from "vitest";
import {
    evaluatorDoneToken,
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
    x402SessionToken,
} from "@/workflows/lib/hook-tokens";

describe("hook tokens", () => {
    it("are deterministic strings derived from arguments", () => {
        expect(jobFundedToken(42n)).toBe("8183:JobFunded:42");
        expect(jobSubmittedToken(42n)).toBe("8183:JobSubmitted:42");
        expect(jobTerminalToken(42n)).toBe("8183:JobTerminal:42");
        expect(evaluatorDoneToken(42n)).toBe("evaluator:42:done");
        expect(x402SessionToken(1n, 2n)).toBe("x402:Session:1:2");
    });

    it("produce the same value across calls (idempotent)", () => {
        expect(jobFundedToken(7n)).toBe(jobFundedToken(7n));
        expect(x402SessionToken(3n, 4n)).toBe(x402SessionToken(3n, 4n));
    });

    it("differentiate distinct event types for the same job id", () => {
        expect(jobFundedToken(1n)).not.toBe(jobSubmittedToken(1n));
        expect(jobSubmittedToken(1n)).not.toBe(jobTerminalToken(1n));
        expect(evaluatorDoneToken(1n)).not.toBe(jobTerminalToken(1n));
    });
});
