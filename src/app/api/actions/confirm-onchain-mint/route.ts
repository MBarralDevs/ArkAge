import { NextResponse } from "next/server";
import { currentBuilder } from "@/lib/auth-context";
import { handleCompleteOnchainRegistration } from "@/mcp/tools/identity/complete-onchain-registration";
import type { McpAuthContext } from "@/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan E2 Phase 3 — dashboard adapter for the second hop. Caller passes
 * the Tx 1 hash they just got back from `eth_sendTransaction`; server
 * polls the receipt, extracts the minted token id, persists it, and
 * returns the Tx 2 envelope (or `tx1_pending` if the receipt isn't ready
 * — the client should retry in `retryAfter` seconds).
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
        agentDbId?: string;
        identityRegisterTxHash?: string;
        idempotencyKey?: string;
    };

    const ctx: McpAuthContext = {
        token: "console",
        builderId: builder.builderId,
        actingAgentId: null,
        actingWalletAddress: builder.primaryWallet as `0x${string}`,
    };

    const result = await handleCompleteOnchainRegistration(
        {
            agentDbId: body.agentDbId,
            identityRegisterTxHash: body.identityRegisterTxHash,
            idempotencyKey:
                body.idempotencyKey ?? `console-anchor-${body.agentDbId}-tx2`,
        },
        ctx,
    );

    return NextResponse.json(result, {
        status: result.ok ? 200 : 400,
    });
}
