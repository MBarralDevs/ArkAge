import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:update_agent_metadata — append a new metadata version for an
 * agent and bump `currentMetadataId` to point at it.
 *
 * `agent_metadata` is append-only — old versions remain queryable for
 * historical context. The Agent.currentMetadataId pointer is the
 * "active" snapshot.
 */

const Input = z.object({
    agentId: z.string().regex(/^[0-9]+$/),
    metadata: z.object({
        name: z.string(),
        description: z.string(),
        capabilities: z.array(z.string()),
        version: z.string(),
    }),
    metadataUri: z.string().url(),
});

export async function handleUpdateAgentMetadata(
    rawInput: unknown,
): Promise<Result<{ metadataId: string }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUnique({ where: { agentId: parse.data.agentId } });
    if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

    const row = await db.agentMetadata.create({
        data: {
            agentId: agent.id,
            metadataUri: parse.data.metadataUri,
            metadataJsonb: parse.data.metadata as object,
            fetchedAt: new Date(),
        },
    });
    await db.agent.update({
        where: { id: agent.id },
        data: { currentMetadataId: row.id },
    });

    return ok({ metadataId: row.id.toString() });
}

registerTool({
    name: "arkage:update_agent_metadata",
    description:
        "Append a new metadata version for an agent (name/description/capabilities/version) and bump currentMetadataId",
    inputSchema: {
        type: "object",
        properties: {
            agentId: { type: "string" },
            metadata: { type: "object" },
            metadataUri: { type: "string" },
        },
        required: ["agentId", "metadata", "metadataUri"],
    },
    handler: handleUpdateAgentMetadata,
});
