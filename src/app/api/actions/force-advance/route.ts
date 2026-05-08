import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentBuilder } from "@/lib/auth-context";
import { resumeHook } from "workflow/api";
import {
    jobFundedToken,
    jobSubmittedToken,
    jobTerminalToken,
} from "@/workflows/lib/hook-tokens";
import { readJob } from "@/lib/erc8183-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buyer-only force-advance for a job. Reads on-chain state via viem
 * and fires the matching deterministic hook token (resumeHook is
 * idempotent on (token, payload), so re-firing is a no-op).
 *
 * Auth gate: requires the signed-in builder's primaryWallet to match
 * the on-chain `client` of the job — keeps random builders from
 * advancing other people's workflows.
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { jobId: string };
    if (!/^[0-9]+$/.test(body.jobId)) {
        return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
    }

    const jobId = BigInt(body.jobId);
    const onChain = await readJob(jobId);

    if (
        onChain.client.toLowerCase() !== builder.primaryWallet.toLowerCase()
    ) {
        return NextResponse.json(
            { error: "only the buyer may force-advance" },
            { status: 403 },
        );
    }

    if (onChain.status === "Funded") {
        await resumeHook(jobFundedToken(jobId), { jobId: body.jobId });
    } else if (onChain.status === "Submitted") {
        await resumeHook(jobSubmittedToken(jobId), {
            jobId: body.jobId,
            deliverable: "0x" + "00".repeat(32),
        });
    } else if (
        onChain.status === "Completed" ||
        onChain.status === "Rejected" ||
        onChain.status === "Expired"
    ) {
        await resumeHook(jobTerminalToken(jobId), {
            status: onChain.status,
        });
    } else {
        return NextResponse.json(
            {
                error: `state ${onChain.status} cannot be force-advanced`,
            },
            { status: 400 },
        );
    }

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builder.primaryWallet,
            action: "force_advance",
            targetKind: "job",
            targetId: body.jobId,
            payloadJsonb: { state: onChain.status } as object,
        },
    });

    return NextResponse.json({ ok: true });
}
