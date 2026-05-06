import { NextResponse } from "next/server";
import { reconcileStuckWorkflows } from "@/workers/reconcile-stuck-workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        console.warn("[cron/reconcile-stuck-workflows] rejected: bad CRON_SECRET");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        const result = await reconcileStuckWorkflows();
        console.log("[cron/reconcile-stuck-workflows] ok", result);
        return NextResponse.json(result);
    } catch (err) {
        console.error("[cron/reconcile-stuck-workflows] failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
