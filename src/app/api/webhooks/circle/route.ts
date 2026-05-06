import { NextResponse } from "next/server";
import { verifyCircleWebhook } from "@/lib/circle-webhook-verify";
import { ingestCircleEvent, type CircleWebhookPayload } from "@/workers/ingest-circle-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
    const secret = process.env.CIRCLE_WEBHOOK_SECRET;
    if (!secret) {
        console.error("[circle-webhook] CIRCLE_WEBHOOK_SECRET not configured");
        return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
    }

    const signature = request.headers.get("x-circle-signature");
    if (!signature) {
        console.warn("[circle-webhook] rejected: missing x-circle-signature header");
        return NextResponse.json({ error: "missing signature" }, { status: 401 });
    }

    const rawBody = await request.text();
    if (!verifyCircleWebhook(rawBody, signature, secret)) {
        console.warn("[circle-webhook] rejected: invalid signature");
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    let payload: CircleWebhookPayload;
    try {
        payload = JSON.parse(rawBody) as CircleWebhookPayload;
    } catch {
        console.warn("[circle-webhook] rejected: body is not valid JSON");
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    try {
        await ingestCircleEvent(payload);
    } catch (err) {
        // Re-throw so Vercel surfaces a 500 in logs/Insights — but log first
        // so we have the payload context alongside the stack trace.
        console.error("[circle-webhook] ingest failed", {
            eventType: payload.eventType,
            eventName: payload.data?.eventName,
            txHash: payload.data?.txHash,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }

    return NextResponse.json({ ok: true });
}
