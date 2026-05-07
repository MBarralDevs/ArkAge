import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:get_reputation — aggregate reputation summary for an agent.
 *
 * Reads the materialized `reputation_feedback` rows hydrated by the
 * Goldsky pipeline (canonical ERC-8004 events) + Circle webhook
 * (ArkAge-emitted events). Returns counts and average score.
 */

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

interface GetReputationOutput {
    agentId: string;
    feedbackCount: number;
    averageScore: number | null;
    positiveCount: number;
    negativeCount: number;
}

export async function handleGetReputation(
    rawInput: unknown,
): Promise<Result<GetReputationOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
    if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

    const fb = await db.reputationFeedback.findMany({
        where: { agentId: agent.id },
        select: { score: true },
    });
    if (fb.length === 0) {
        return ok({
            agentId: parse.data.agentId,
            feedbackCount: 0,
            averageScore: null,
            positiveCount: 0,
            negativeCount: 0,
        });
    }
    const total = fb.reduce((s, r) => s + (r.score ?? 0), 0);
    const positive = fb.filter((r) => (r.score ?? 0) > 0).length;
    const negative = fb.filter((r) => (r.score ?? 0) < 0).length;

    return ok({
        agentId: parse.data.agentId,
        feedbackCount: fb.length,
        averageScore: total / fb.length,
        positiveCount: positive,
        negativeCount: negative,
    });
}

registerTool({
    name: "arkage:get_reputation",
    description: "Aggregate reputation stats for an agent (avg score, positive/negative counts)",
    inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
    },
    handler: handleGetReputation,
});
