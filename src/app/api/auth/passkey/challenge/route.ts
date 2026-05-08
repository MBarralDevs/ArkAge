import { NextResponse } from "next/server";
import { startAuthentication, startRegistration } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
    const body = (await request.json()) as {
        mode?: "register" | "authenticate";
        builderWallet?: string;
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
    const options =
        body.mode === "register"
            ? await startRegistration(body.builderWallet)
            : await startAuthentication(body.builderWallet);
    return NextResponse.json(options);
}
