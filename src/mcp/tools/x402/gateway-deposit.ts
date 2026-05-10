import { z } from "zod";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { db } from "@/lib/db";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { depositTier2ToGateway } from "@/lib/tier2-dcw";

/**
 * arkage:gateway_deposit — top up the Circle GatewayWallet balance for
 * an agent's Tier 2 EOA so subsequent `pay_and_call` invocations have
 * settle-able funds.
 *
 * Plan D Phase B prerequisite: the batched x402 scheme (Circle's
 * `GatewayWalletBatched`) verifies payments against the buyer's
 * GatewayWallet deposit, NOT their bare EOA balance. Without a deposit,
 * Circle's facilitator returns `Payment verification failed`.
 *
 * v1 testnet limitation: requires the per-wallet env-staged private key
 * (`ARKAGE_TIER2_KEY_<walletId>`) per LBC-1.
 */

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    amountUsdc: z
        .string()
        .regex(/^[0-9]+(\.[0-9]{1,6})?$/)
        .default("1.00"),
    idempotencyKey: z.string().min(1),
});

interface Output {
    walletId: string;
    walletAddress: string;
    amountUsdc: string;
    depositTxHash: string | null;
    alreadyFunded: boolean;
}

export async function handleGatewayDeposit(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));

    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(
                agent.operatorWallet.replace(/^0x/, ""),
                "hex",
            ),
        },
    });

    const eoaPrivateKey = process.env[`ARKAGE_TIER2_KEY_${wallet.id}`] as
        | `0x${string}`
        | undefined;
    if (!eoaPrivateKey) {
        return err(
            "config_error",
            `Tier 2 EOA key not provisioned in env (ARKAGE_TIER2_KEY_${wallet.id})`,
        );
    }

    try {
        const result = await depositTier2ToGateway(
            wallet.id,
            eoaPrivateKey,
            parse.data.amountUsdc,
        );
        return ok({
            walletId: wallet.id.toString(),
            walletAddress: agent.operatorWallet,
            amountUsdc: parse.data.amountUsdc,
            depositTxHash: result.depositTxHash,
            alreadyFunded: result.alreadyFunded,
        });
    } catch (e) {
        return err(
            "gateway_deposit_failed",
            e instanceof Error ? e.message : String(e),
        );
    }
}

registerTool({
    name: "arkage:gateway_deposit",
    description:
        "Deposit USDC into the Circle GatewayWallet for an agent's Tier 2 EOA, enabling batched x402 payments.",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            amountUsdc: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "idempotencyKey"],
    },
    handler: handleGatewayDeposit,
});
