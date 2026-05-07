import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";

/**
 * arkage:get_agent_info — read identity, operator wallet, active flag,
 * and the latest metadata snapshot for a given agent.
 *
 * Public read; no auth scope check beyond the bearer token. Used by
 * marketplace consumers (e.g. clients picking a provider) and by an
 * agent's own operator inspecting itself.
 */

const Input = z.object({ agentId: z.string().regex(/^[0-9]+$/) });

interface AgentInfoOutput {
    agentId: string;
    identityOwner: string;
    operatorWallet: string;
    active: boolean;
    metadata:
        | { name: string; description: string; capabilities: string[]; version: string }
        | null;
}

export async function handleGetAgentInfo(rawInput: unknown): Promise<Result<AgentInfoOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUnique({
        where: { agentId: parse.data.agentId },
        include: {
            metadata: { orderBy: { createdAt: "desc" }, take: 1 },
            currentOperatorWallet: true,
        },
    });
    if (!agent) return err("not_found", `agent ${parse.data.agentId} not found`);

    const m = agent.metadata[0]?.metadataJsonb as
        | { name: string; description: string; capabilities: string[]; version: string }
        | undefined;

    return ok({
        agentId: agent.agentId.toString(),
        identityOwner: "0x" + Buffer.from(agent.identityOwnerWallet).toString("hex"),
        operatorWallet:
            "0x" + Buffer.from(agent.currentOperatorWallet.address).toString("hex"),
        active: agent.active,
        metadata: m ?? null,
    });
}

registerTool({
    name: "arkage:get_agent_info",
    description:
        "Read agent identity owner, operator wallet, active flag, and latest metadata snapshot",
    inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
    },
    handler: handleGetAgentInfo,
});
