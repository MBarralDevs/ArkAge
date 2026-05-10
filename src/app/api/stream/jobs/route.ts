import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polling endpoint for the global job-event feed.
 *
 * Plan C originally used Postgres LISTEN/NOTIFY + SSE for sub-second
 * updates, but `pg-listen` (via `pg-format`) does a runtime
 * `require('./reserved')` that Vercel's serverless tracer can't
 * resolve when the package is in `serverExternalPackages`. We swap
 * the long-lived LISTEN connection for short-poll: the client hits
 * `?since=<unix-ms>` every few seconds and we return any `job_events`
 * rows newer than that. Slightly higher latency (3-5s), trivial
 * runtime cost, no native-module bundling drama.
 *
 * Response shape:
 *   { events: [{ jobId, eventKind, blockTime, txHash }], serverTime }
 *
 * The trigger migration (Plan C Task 4) and `src/lib/pg-notify.ts`
 * stay in place — they're cheap and useful when we eventually run a
 * dedicated worker outside Vercel functions.
 */

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sinceMs = parseInt(url.searchParams.get("since") ?? "0", 10);
    const since = Number.isFinite(sinceMs) && sinceMs > 0
        ? new Date(sinceMs)
        : new Date(Date.now() - 60_000);

    const rows = await db.jobEvent.findMany({
        where: { blockTime: { gt: since } },
        orderBy: { blockTime: "desc" },
        take: 50,
        select: {
            jobId: true,
            eventKind: true,
            blockTime: true,
            txHash: true,
            job: { select: { jobId: true } },
        },
    });

    const events = rows.map((r) => ({
        jobId: r.job.jobId.toString(),
        eventKind: r.eventKind,
        blockTime: r.blockTime.toISOString(),
        txHash: "0x" + Buffer.from(r.txHash).toString("hex"),
    }));

    return NextResponse.json(
        { events, serverTime: Date.now() },
        { headers: { "Cache-Control": "no-store" } },
    );
}
