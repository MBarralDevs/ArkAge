/**
 * Deterministic hook tokens.
 *
 * Every workflow chain-event await uses a token derived solely from
 * static identifiers (job id, agent ids). The indexer push path and the
 * stuck-workflow rescue path BOTH derive the same token from the same
 * inputs, so resumeHook on either lands on the same waiting hook —
 * subsequent fires are no-ops, giving us the idempotency the spec
 * requires (Risk #2 mitigation).
 */

export const jobFundedToken = (jobId: bigint) =>
    `8183:JobFunded:${jobId}` as const;

export const jobSubmittedToken = (jobId: bigint) =>
    `8183:JobSubmitted:${jobId}` as const;

export const jobTerminalToken = (jobId: bigint) =>
    `8183:JobTerminal:${jobId}` as const;

export const evaluatorDoneToken = (jobId: bigint) =>
    `evaluator:${jobId}:done` as const;

export const x402SessionToken = (buyerAgentId: bigint, sellerAgentId: bigint) =>
    `x402:Session:${buyerAgentId}:${sellerAgentId}` as const;
