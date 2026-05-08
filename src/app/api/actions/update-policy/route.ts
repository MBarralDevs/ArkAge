import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentBuilder } from "@/lib/auth-context";
import { hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Append-only policy version write. Closes out `validTo` on the
 * previous policy row, creates a new row at version+1 with a fresh
 * canonical hash, and updates `Agent.currentPolicyId`.
 *
 * Auth: builder session + ownership of the agent (via wallet.builderId).
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
        agentId: string;
        patch: Partial<AgentPolicy>;
    };
    if (!/^[0-9]+$/.test(body.agentId)) {
        return NextResponse.json(
            { error: "invalid agentId" },
            { status: 400 },
        );
    }

    const agent = await db.agent.findUnique({
        where: { agentId: body.agentId },
        include: {
            currentOperatorWallet: true,
            policies: { orderBy: { version: "desc" }, take: 1 },
        },
    });
    if (
        !agent ||
        agent.currentOperatorWallet.builderId !== builder.builderId
    ) {
        return NextResponse.json(
            { error: "not authorized for this agent" },
            { status: 403 },
        );
    }

    const prev = agent.policies[0];
    if (!prev) {
        return NextResponse.json(
            { error: "no current policy" },
            { status: 400 },
        );
    }

    const prevBody = prev.bodyJsonb as unknown as AgentPolicy;
    const next: AgentPolicy = {
        ...prevBody,
        ...body.patch,
        spendCaps: { ...prevBody.spendCaps, ...(body.patch.spendCaps ?? {}) },
        counterpartyRules: {
            ...prevBody.counterpartyRules,
            ...(body.patch.counterpartyRules ?? {}),
        },
        version: prev.version + 1,
    };
    const hash = hashPolicy(next);

    await db.policy.update({
        where: { id: prev.id },
        data: { validTo: new Date() },
    });
    const nextRow = await db.policy.create({
        data: {
            agentId: agent.id,
            version: next.version,
            bodyJsonb: next as unknown as object,
            canonicalHash: Buffer.from(hash.replace(/^0x/, ""), "hex"),
            validFrom: new Date(),
            authoredByWallet: Buffer.from(
                builder.primaryWallet.replace(/^0x/, ""),
                "hex",
            ),
        },
    });
    await db.agent.update({
        where: { id: agent.id },
        data: { currentPolicyId: nextRow.id },
    });

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builder.primaryWallet,
            action: "policy.update",
            targetKind: "agent",
            targetId: agent.agentId.toString(),
            payloadJsonb: { newVersion: next.version, hash } as object,
        },
    });

    return NextResponse.json({ ok: true, version: next.version, hash });
}
