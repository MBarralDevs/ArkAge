import { NextResponse } from "next/server";
import { verifyX402FacilitatorWebhook } from "@/lib/x402-facilitator-verify";
import {
    ingestFacilitatorEvent,
    type FacilitatorWebhookPayload,
} from "@/workers/ingest-x402-settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST handler for Circle's x402 facilitator settlement webhook.
 *
 * HMAC SHA-256 verification before any DB writes. Returns 401 on
 * missing or invalid signature; 400 on malformed JSON; 500 if the
 * shared secret env var isn't configured. Successful events route
 * through `ingestFacilitatorEvent` which routes to audit_log +
 * treasury_movements + receipt updates.
 */
export async function POST(request: Request): Promise<Response> {
    const secret = process.env.CIRCLE_X402_FACILITATOR_SECRET;
    if (!secret) {
        return NextResponse.json(
            { error: "secret not configured" },
            { status: 500 },
        );
    }

    const sig = request.headers.get("x-circle-signature");
    if (!sig) {
        return NextResponse.json(
            { error: "missing signature" },
            { status: 401 },
        );
    }

    const raw = await request.text();
    if (!verifyX402FacilitatorWebhook(raw, sig, secret)) {
        return NextResponse.json(
            { error: "invalid signature" },
            { status: 401 },
        );
    }

    let payload: FacilitatorWebhookPayload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return NextResponse.json(
            { error: "invalid json" },
            { status: 400 },
        );
    }

    await ingestFacilitatorEvent(payload);
    return NextResponse.json({ ok: true });
}
