import { NextResponse } from "next/server";
import { currentBuilder } from "@/lib/auth-context";
import { handleRegisterAgentOnchain } from "@/mcp/tools/identity/register-agent-onchain";
import type { McpAuthContext } from "@/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan E2 Phase 3 — dashboard adapter. Wraps `handleRegisterAgentOnchain`
 * with `currentBuilder()` session auth so the console UI can drive the
 * on-chain anchoring flow without going through the HTTP MCP transport.
 *
 * Returns the same envelope shape the MCP tool returns:
 *   { ok: true, data: { state: "awaiting_tx1", agentDbId, metadataURI, pendingActions } }
 * The client uses `pendingActions[0].unsignedTx` to drive an
 * `eth_sendTransaction` call against the builder's injected wallet.
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
        agentDbId?: string;
        metadataURI?: string;
        idempotencyKey?: string;
    };

    const ctx: McpAuthContext = {
        token: "console",
        builderId: builder.builderId,
        actingAgentId: null,
        actingWalletAddress: builder.primaryWallet as `0x${string}`,
    };

    const result = await handleRegisterAgentOnchain(
        {
            agentDbId: body.agentDbId,
            metadataURI: body.metadataURI,
            idempotencyKey:
                body.idempotencyKey ?? `console-anchor-${body.agentDbId}-tx1`,
        },
        ctx,
    );

    return NextResponse.json(result, {
        status: result.ok ? 200 : 400,
    });
}
