import { db } from "@/lib/db";
import { ok, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import { publicClient } from "@/lib/chain";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { ERC20_ABI } from "@/lib/abis";
import { getTier3Address } from "@/lib/tier3-system";

/**
 * arkage:get_treasury_position — current ArkAge treasury USDC balance
 * (live read from chain) plus lifetime in/out aggregates from
 * `treasury_movements` table.
 *
 * Public read; no auth scope check beyond the bearer token.
 */

interface TreasuryPositionOutput {
    treasuryAddress: string;
    usdcBalance: string;
    totalFeesIn: string;
    totalWithdrawalsOut: string;
}

export async function handleGetTreasuryPosition(): Promise<Result<TreasuryPositionOutput>> {
    const treasury = getTier3Address("treasury");
    const balance = await publicClient.readContract({
        address: ARC_TESTNET_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [treasury],
    });

    const movements = await db.treasuryMovement.findMany({
        select: { direction: true, amount: true },
    });
    const totalIn = movements
        .filter((m) => m.direction === "in")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
    const totalOut = movements
        .filter((m) => m.direction === "out")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);

    return ok({
        treasuryAddress: treasury,
        usdcBalance: balance.toString(),
        totalFeesIn: totalIn.toString(),
        totalWithdrawalsOut: totalOut.toString(),
    });
}

registerTool({
    name: "arkage:get_treasury_position",
    description: "Read ArkAge treasury USDC balance and lifetime in/out totals",
    inputSchema: { type: "object", properties: {} },
    handler: handleGetTreasuryPosition,
});
