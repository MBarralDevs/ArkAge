/**
 * Evaluator prompt templates + tier→model selection.
 *
 * Versioned ("v1.0.0") so changes to the system prompt or output schema
 * can be detected by `evidenceHash` consumers — the evaluation row
 * stores the prompt version + hash alongside the verdict.
 *
 * Model IDs target Vercel AI Gateway and use plain `provider/model`
 * strings (per Vercel best practice). Verified live against
 * https://ai-gateway.vercel.sh/v1/models on 2026-05-07; bump as new
 * minors ship.
 */

export const EVALUATOR_PROMPT_VERSION = "v1.0.0";

export const EVALUATOR_SYSTEM_PROMPT = `You are ArkAge's autonomous evaluator for ERC-8183 agentic-commerce jobs on Arc Testnet.

Your role:
1. Read the job description, the provider's deliverable, and any attached evidence.
2. Decide whether the deliverable satisfies the description.
3. Output a JSON object with this exact shape:
   {
     "verdict": "accept" | "reject",
     "score": <integer -100..100>,
     "reasoning": "<2-5 sentences explaining your decision>",
     "concerns": ["<concern 1>", "<concern 2>", ...]
   }

Be strict but fair. Reject if:
- The deliverable does not address the description.
- The deliverable contains obvious errors or fabrication.
- Required artifacts are missing.

Accept if:
- The deliverable substantively addresses the request.
- Quality is acceptable for the budget paid.
- Any minor issues are noted in "concerns" but do not warrant rejection.

Never accept blank, gibberish, or wildly off-topic deliverables.`;

export type EvaluatorTier = "fast" | "standard" | "premium";

/**
 * Returns the AI Gateway model ID for a given tier.
 *
 * IMPORTANT: model IDs evolve. Verify before each redeploy:
 *   curl -s https://ai-gateway.vercel.sh/v1/models | \
 *     python3 -c 'import sys,json; print("\n".join(sorted([m["id"] for m in json.load(sys.stdin)["data"] if m["id"].startswith("anthropic/")], reverse=True)))'
 *
 * Use the highest version available for each tier.
 */
export function modelForTier(tier: EvaluatorTier): string {
    switch (tier) {
        case "fast":
            return "anthropic/claude-haiku-4.5";
        case "standard":
            return "anthropic/claude-sonnet-4.6";
        case "premium":
            return "anthropic/claude-opus-4.7";
    }
}

export function buildEvaluationPrompt(args: {
    jobId: bigint;
    description: string;
    deliverable: { hash: string; content: string };
    budget: bigint;
}): string {
    return `# Job ${args.jobId}

## Description
${args.description}

## Budget
${(Number(args.budget) / 1_000_000).toFixed(2)} USDC

## Deliverable
Hash: ${args.deliverable.hash}

\`\`\`
${args.deliverable.content}
\`\`\`

Now evaluate per your system instructions. Respond with the JSON object only — no surrounding text.`;
}
