import { NextResponse } from "next/server";
import { fetchCirclePublicKey, verifyCircleSignature } from "@/lib/circle-webhook-verify";
import { ingestCircleEvent, type CircleNotificationEnvelope } from "@/workers/ingest-circle-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) {
        console.error("[circle-webhook] CIRCLE_API_KEY not configured");
        return NextResponse.json({ error: "circle api key not configured" }, { status: 500 });
    }

    const signature = request.headers.get("x-circle-signature");
    const keyId = request.headers.get("x-circle-key-id");
    if (!signature || !keyId) {
        console.warn("[circle-webhook] rejected: missing signature or key id headers", {
            hasSignature: Boolean(signature),
            hasKeyId: Boolean(keyId),
        });
        return NextResponse.json({ error: "missing signature headers" }, { status: 401 });
    }

    const rawBody = await request.text();

    let publicKey: ReturnType<typeof fetchCirclePublicKey> extends Promise<infer T> ? T : never;
    try {
        publicKey = await fetchCirclePublicKey(keyId, apiKey);
    } catch (err) {
        console.error("[circle-webhook] public key fetch failed", {
            keyId,
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "public key fetch failed" }, { status: 401 });
    }

    if (!verifyCircleSignature(rawBody, signature, publicKey.keyObject)) {
        console.warn("[circle-webhook] rejected: invalid signature", { keyId });
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    let payload: CircleNotificationEnvelope;
    try {
        payload = JSON.parse(rawBody) as CircleNotificationEnvelope;
    } catch {
        console.warn("[circle-webhook] rejected: body is not valid JSON");
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    try {
        await ingestCircleEvent(payload);
    } catch (err) {
        console.error("[circle-webhook] ingest failed", {
            notificationType: payload.notificationType,
            notificationId: payload.notificationId,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }

    return NextResponse.json({ ok: true });
}
