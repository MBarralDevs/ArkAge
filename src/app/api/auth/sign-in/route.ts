import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { finishAuthentication } from "@/lib/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verifies a passkey assertion AND issues an iron-session cookie
 * binding the session to the matching `builders` row. Two failure
 * modes return 401/404 separately so the client can surface
 * "wrong key" vs "no builder" distinctly.
 */
export async function POST(request: Request): Promise<Response> {
    const body = (await request.json()) as {
        builderWallet: string;
        response: AuthenticationResponseJSON;
    };
    if (
        !body.builderWallet ||
        !/^0x[a-fA-F0-9]{40}$/.test(body.builderWallet)
    ) {
        return NextResponse.json(
            { error: "invalid builderWallet" },
            { status: 400 },
        );
    }

    try {
        await finishAuthentication(body.builderWallet, body.response);
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "auth failed" },
            { status: 401 },
        );
    }

    const builderBytes = Buffer.from(body.builderWallet.slice(2), "hex");
    const builder = await db.builder.findUnique({
        where: { primaryWallet: builderBytes },
    });
    if (!builder) {
        return NextResponse.json(
            { error: "builder not found" },
            { status: 404 },
        );
    }

    const session = await getSession();
    session.builderId = builder.id.toString();
    session.builderWallet = body.builderWallet;
    session.signedInAt = Date.now();
    await session.save();

    return NextResponse.json({
        ok: true,
        builderId: builder.id.toString(),
    });
}
