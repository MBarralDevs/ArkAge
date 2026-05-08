import { NextResponse } from "next/server";
import { reconcileTreasury } from "@/workers/reconcile-treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        console.warn(
            "[cron/reconcile-treasury] rejected: bad CRON_SECRET",
        );
        return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 },
        );
    }

    try {
        const report = await reconcileTreasury();
        console.log("[cron/reconcile-treasury] ok", report);
        return NextResponse.json(report);
    } catch (err) {
        console.error("[cron/reconcile-treasury] failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
