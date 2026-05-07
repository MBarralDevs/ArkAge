import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:compare_agents — side-by-side reputation summary for 2-10
 * agents in a single round-trip. Used by the dashboard's "pick a
 * provider" view and by clients programmatically choosing between
 * providers.
 */

const Input = z.object({
    agentIds: z.array(z.string().regex(/^[0-9]+$/)).min(2).max(10),
});

interface ComparisonEntry {
    agentId: string;
    feedbackCount: number;
    averageScore: number | null;
}

export async function handleCompareAgents(
    rawInput: unknown,
): Promise<Result<{ comparison: ComparisonEntry[] }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agents = await db.agent.findMany({
        where: { agentId: { in: parse.data.agentIds } },
    });
    if (agents.length !== parse.data.agentIds.length) {
        return err("not_found", "one or more agents missing");
    }

    const comparison = await Promise.all(
        agents.map(async (a) => {
            const fb = await db.reputationFeedback.findMany({
                where: { agentId: a.id },
                select: { score: true },
            });
            const total = fb.reduce((s, r) => s + (r.score ?? 0), 0);
            return {
                agentId: a.agentId.toString(),
                feedbackCount: fb.length,
                averageScore: fb.length ? total / fb.length : null,
            };
        }),
    );

    return ok({ comparison });
}

registerTool({
    name: "arkage:compare_agents",
    description: "Compare reputation summaries across 2-10 agents in one call",
    inputSchema: {
        type: "object",
        properties: { agentIds: { type: "array", items: { type: "string" } } },
        required: ["agentIds"],
    },
    handler: handleCompareAgents,
});
