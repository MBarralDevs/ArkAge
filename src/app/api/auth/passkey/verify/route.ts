import { NextResponse } from "next/server";
import {
    finishAuthentication,
    finishRegistration,
} from "@/lib/webauthn";
import type {
    AuthenticationResponseJSON,
    RegistrationResponseJSON,
} from "@simplewebauthn/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
    const body = (await request.json()) as {
        mode: "register" | "authenticate";
        builderWallet: string;
        response: unknown;
    };
    if (!body.builderWallet) {
        return NextResponse.json(
            { error: "builderWallet required" },
            { status: 400 },
        );
    }
    try {
        const result =
            body.mode === "register"
                ? await finishRegistration(
                      body.builderWallet,
                      body.response as RegistrationResponseJSON,
                  )
                : await finishAuthentication(
                      body.builderWallet,
                      body.response as AuthenticationResponseJSON,
                  );
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json(
            {
                error:
                    e instanceof Error ? e.message : "verification failed",
            },
            { status: 401 },
        );
    }
}
