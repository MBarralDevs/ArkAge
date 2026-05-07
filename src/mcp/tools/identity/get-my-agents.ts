import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

/**
 * arkage:get_my_agents — list every agent the authenticated builder
 * controls (Tier 2 operator wallets they own → linked agent rows).
 *
 * Auth-scoped: results are filtered by `ctx.builderId` from the bearer
 * token. Returns an empty list if the builder has no Tier 2 wallets.
 */

interface MyAgentsOutput {
    agents: Array<{ agentId: string; operatorWallet: string; active: boolean }>;
}

export async function handleGetMyAgents(
    _input: unknown,
    ctx: McpAuthContext,
): Promise<Result<MyAgentsOutput>> {
    const wallets = await db.wallet.findMany({
        where: { builderId: ctx.builderId, tier: 2 },
        select: { id: true, address: true },
    });
    if (wallets.length === 0) return ok({ agents: [] });

    const agents = await db.agent.findMany({
        where: { currentOperatorWalletId: { in: wallets.map((w) => w.id) } },
        select: { agentId: true, currentOperatorWallet: true, active: true },
    });

    return ok({
        agents: agents.map((a) => ({
            agentId: a.agentId.toString(),
            operatorWallet:
                "0x" + Buffer.from(a.currentOperatorWallet.address).toString("hex"),
            active: a.active,
        })),
    });
}

registerTool({
    name: "arkage:get_my_agents",
    description: "List all agents owned by the authenticated builder",
    inputSchema: { type: "object", properties: {} },
    handler: handleGetMyAgents,
});
