import { NextResponse } from "next/server";
import { currentBuilder } from "@/lib/auth-context";
import { handleFinalizeOnchainRegistration } from "@/mcp/tools/identity/finalize-onchain-registration";
import type { McpAuthContext } from "@/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan E2 Phase 3 — dashboard adapter for the closing hop. Caller passes
 * the Tx 2 hash from the AgentRegistry.registerAgent broadcast; server
 * polls the receipt, validates target contract + status, stamps
 * `on_chain_registered_at`. After this returns success the badge on the
 * agent profile flips to "On-chain #<id> ↗" on `router.refresh()`.
 */
export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
        agentDbId?: string;
        agentRegistryTxHash?: string;
        idempotencyKey?: string;
    };

    const ctx: McpAuthContext = {
        token: "console",
        builderId: builder.builderId,
        actingAgentId: null,
        actingWalletAddress: builder.primaryWallet as `0x${string}`,
    };

    const result = await handleFinalizeOnchainRegistration(
        {
            agentDbId: body.agentDbId,
            agentRegistryTxHash: body.agentRegistryTxHash,
            idempotencyKey:
                body.idempotencyKey ??
                `console-anchor-${body.agentDbId}-finalize`,
        },
        ctx,
    );

    return NextResponse.json(result, {
        status: result.ok ? 200 : 400,
    });
}
