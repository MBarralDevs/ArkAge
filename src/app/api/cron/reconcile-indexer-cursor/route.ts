import { NextResponse } from "next/server";
import { reconcileIndexerCursor } from "@/workers/reconcile-indexer-cursor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        console.warn("[cron/reconcile-indexer-cursor] rejected: bad CRON_SECRET");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        const reports = await reconcileIndexerCursor();
        // BigInt isn't JSON-serializable; convert before returning.
        const safe = reports.map((r) => ({
            ...r,
            lastIndexedBlock: r.lastIndexedBlock.toString(),
            chainHeadBlock: r.chainHeadBlock.toString(),
            lagBlocks: r.lagBlocks.toString(),
        }));
        console.log("[cron/reconcile-indexer-cursor] ok", { count: safe.length });
        return NextResponse.json({ cursors: safe });
    } catch (err) {
        console.error("[cron/reconcile-indexer-cursor] failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
