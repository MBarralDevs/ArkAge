import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentBuilder } from "@/lib/auth-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Off-chain revoke: flips `Agent.active=false` and `Wallet.status=revoked`
 * so the MCP server stops honoring tool calls for this agent. The
 * on-chain `AgentRegistry.deactivate` requires a fresh Tier 1 passkey
 * signature — wired through `PendingActionsPanel` in v1.5; for v1 the
 * builder can call the MCP `arkage:revoke_agent` to capture the
 * unsigned tx payload separately.
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { agentId: string };
    const agent = await db.agent.findUnique({
        where: { agentId: body.agentId },
        include: { currentOperatorWallet: true },
    });
    if (
        !agent ||
        agent.currentOperatorWallet.builderId !== builder.builderId
    ) {
        return NextResponse.json(
            { error: "not authorized" },
            { status: 403 },
        );
    }

    await db.agent.update({
        where: { id: agent.id },
        data: { active: false },
    });
    await db.wallet.update({
        where: { id: agent.currentOperatorWalletId },
        data: { status: "revoked" },
    });
    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builder.primaryWallet,
            action: "agent.revoke",
            targetKind: "agent",
            targetId: agent.agentId.toString(),
            payloadJsonb: {} as object,
        },
    });

    return NextResponse.json({ ok: true });
}
