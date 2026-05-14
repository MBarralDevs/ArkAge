import { NextResponse } from "next/server";
import { normalizeFromGoldsky } from "@/workers/normalize-from-goldsky";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        console.warn("[cron/normalize-goldsky] rejected: bad CRON_SECRET");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        const reports = await normalizeFromGoldsky();
        const safe = reports.map((r) => ({
            ...r,
            fromBlock: r.fromBlock.toString(),
            toBlock: r.toBlock.toString(),
        }));
        const totalDispatched = safe.reduce(
            (a, r) => a + r.rowsDispatched,
            0,
        );
        console.log("[cron/normalize-goldsky] ok", {
            contracts: safe.length,
            totalDispatched,
        });
        return NextResponse.json({ contracts: safe, totalDispatched });
    } catch (err) {
        console.error("[cron/normalize-goldsky] failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
