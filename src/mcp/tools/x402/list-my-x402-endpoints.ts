import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

const Input = z.object({ asAgent: z.string().regex(/^[0-9]+$/) });

export async function handleListMyEndpoints(
    rawInput: unknown,
): Promise<Result<{ endpoints: unknown[] }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUniqueOrThrow({
        where: { agentId: parse.data.asAgent },
    });
    const rows = await db.x402Endpoint.findMany({
        where: { sellerAgentId: agent.id },
        orderBy: { registeredAt: "desc" },
    });

    return ok({
        endpoints: rows.map((r) => ({
            endpointId: r.id.toString(),
            url: r.url,
            effectiveUrl: r.effectiveUrl,
            hosting: r.hosting,
            pricePerCall: r.pricePerCall.toString(),
            active: r.active,
        })),
    });
}

registerTool({
    name: "arkage:list_my_x402_endpoints",
    description: "List x402 endpoints registered by an agent",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
        },
        required: ["asAgent"],
    },
    handler: handleListMyEndpoints,
});
