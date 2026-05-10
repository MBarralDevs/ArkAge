import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-job polling endpoint. Same shape as `/api/stream/jobs` but
 * scoped to one job — used by `/jobs/[id]` for live event-list
 * updates.
 *
 * See `../jobs/route.ts` for why we poll instead of LISTEN/SSE.
 */

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) {
        return NextResponse.json({ error: "bad id" }, { status: 400 });
    }

    const job = await db.job.findUnique({
        where: { jobId: id },
        select: { id: true },
    });
    if (!job) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const sinceMs = parseInt(url.searchParams.get("since") ?? "0", 10);
    const since =
        Number.isFinite(sinceMs) && sinceMs > 0
            ? new Date(sinceMs)
            : new Date(Date.now() - 60_000);

    const rows = await db.jobEvent.findMany({
        where: { jobId: job.id, blockTime: { gt: since } },
        orderBy: { blockTime: "desc" },
        take: 50,
        select: {
            eventKind: true,
            blockTime: true,
            txHash: true,
        },
    });

    const events = rows.map((r) => ({
        jobId: id,
        eventKind: r.eventKind,
        blockTime: r.blockTime.toISOString(),
        txHash: "0x" + Buffer.from(r.txHash).toString("hex"),
    }));

    return NextResponse.json(
        { events, serverTime: Date.now() },
        { headers: { "Cache-Control": "no-store" } },
    );
}
