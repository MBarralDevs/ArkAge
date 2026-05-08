import { db } from "@/lib/db";
import { publicClient } from "@/lib/chain";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { ERC20_ABI } from "@/lib/abis";
import { getTier3Address } from "@/lib/tier3-system";

/**
 * Treasury reconciliation worker (Plan D Phase 4).
 *
 * Compares the on-chain USDC balance held by the ArkAge Tier 3
 * `treasury` wallet against the net of recorded `treasury_movements`
 * rows (sum(in) − sum(out)). Logs drift to `audit_log` so the admin
 * `/admin/system-health` page can surface silent divergence.
 *
 * Drift is expected to be transient (Circle Gateway settlements
 * arrive batched, so on-chain balance can lead recorded inflows by
 * up to a batching interval). Persistent non-zero drift signals a
 * missed event or a manual movement we didn't ingest.
 */
export interface TreasuryReport {
    onChainBalanceRaw: string;
    recordedNetRaw: string;
    drift: string;
    driftDirection: "balance_higher" | "balance_lower" | "in_sync";
}

export async function reconcileTreasury(): Promise<TreasuryReport> {
    const treasury = getTier3Address("treasury");

    const onChainBalance = (await publicClient.readContract({
        address: ARC_TESTNET_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [treasury],
    })) as bigint;

    const movements = await db.treasuryMovement.findMany({
        select: { direction: true, amount: true },
    });
    const inSum = movements
        .filter((m) => m.direction === "in")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
    const outSum = movements
        .filter((m) => m.direction === "out")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
    const net = inSum - outSum;

    const drift = onChainBalance - net;
    const direction =
        drift === 0n
            ? "in_sync"
            : drift > 0n
              ? "balance_higher"
              : "balance_lower";

    if (drift !== 0n) {
        await db.auditLog.create({
            data: {
                actorKind: "system",
                actorId: "treasury-reconciler",
                action: `treasury.drift.${direction}`,
                payloadJsonb: {
                    onChainBalance: onChainBalance.toString(),
                    recordedNet: net.toString(),
                    drift: drift.toString(),
                } as object,
            },
        });
    }

    return {
        onChainBalanceRaw: onChainBalance.toString(),
        recordedNetRaw: net.toString(),
        drift: drift.toString(),
        driftDirection: direction,
    };
}
