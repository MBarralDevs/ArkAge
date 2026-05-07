import { z } from "zod";
import { encodeFunctionData, type Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { ERC20_ABI } from "@/lib/abis";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { signWithTier3 } from "@/lib/tier3-system";

/**
 * arkage:withdraw_treasury — admin-gated USDC withdrawal from the
 * Tier 3 treasury wallet.
 *
 * Auth model: caller's `ctx.builderId` must appear in
 * `ARKAGE_ADMIN_BUILDERS` (comma-separated env list of bigint ids).
 * The treasury wallet itself is a Circle DCW EOA, signed via Tier 3.
 *
 * Records the withdrawal in `treasury_movements` for audit + reporting.
 */

const Input = z.object({
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string().regex(/^[0-9]+$/),
    memo: z.string().optional(),
    idempotencyKey: z.string().min(1),
});

interface WithdrawOutput {
    transactionId: string;
    state: string;
}

export async function handleWithdrawTreasury(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<WithdrawOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const adminList = process.env.ARKAGE_ADMIN_BUILDERS?.split(",") ?? [];
    if (!adminList.includes(ctx.builderId.toString())) {
        return err("not_authorized", "treasury withdraw is admin-only");
    }

    const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [parse.data.to as Address, BigInt(parse.data.amount)],
    });
    const queued = await signWithTier3("treasury", ARC_TESTNET_ADDRESSES.USDC, data);

    await db.treasuryMovement.create({
        data: {
            kind: "manual_withdraw",
            amount: parse.data.amount,
            tokenAddress: Buffer.from(
                ARC_TESTNET_ADDRESSES.USDC.replace(/^0x/, ""),
                "hex",
            ),
            direction: "out",
            counterparty: Buffer.from(parse.data.to.replace(/^0x/, ""), "hex"),
            // txHash unknown until queued tx mines — backfilled by the
            // ingest worker when the on-chain Transfer event lands.
            blockTime: new Date(),
        },
    });

    return ok({ transactionId: queued.transactionId, state: queued.state });
}

registerTool({
    name: "arkage:withdraw_treasury",
    description: "Admin-gated USDC withdrawal from the ArkAge treasury wallet",
    inputSchema: {
        type: "object",
        properties: {
            to: { type: "string" },
            amount: { type: "string" },
            memo: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["to", "amount", "idempotencyKey"],
    },
    handler: handleWithdrawTreasury,
});
