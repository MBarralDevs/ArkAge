import { db } from "@/lib/db";
import { publicClient } from "@/lib/chain";

export interface CursorReport {
    source: string;
    contractAddress: string;
    lastIndexedBlock: bigint;
    chainHeadBlock: bigint;
    lagBlocks: bigint;
}

const LAG_WARNING_THRESHOLD = 100n;

/**
 * Compare each indexer's `last_block` cursor against the live chain head.
 * Emits an `indexer_lag_warning` audit_log row for any cursor lagging
 * by more than LAG_WARNING_THRESHOLD blocks. The reconciler does NOT
 * advance cursors itself — that's the indexer's job. This worker is
 * purely a freshness probe that flags pipeline drops.
 */
export async function reconcileIndexerCursor(): Promise<CursorReport[]> {
    const cursors = await db.indexerCursor.findMany();
    const head = await publicClient.getBlockNumber();

    const reports: CursorReport[] = [];
    for (const c of cursors) {
        const lastIndexed = BigInt(c.lastBlock.toString());
        const lag = head - lastIndexed;
        const addressHex = "0x" + Buffer.from(c.contractAddress).toString("hex");

        reports.push({
            source: c.source,
            contractAddress: addressHex,
            lastIndexedBlock: lastIndexed,
            chainHeadBlock: head,
            lagBlocks: lag,
        });

        if (lag > LAG_WARNING_THRESHOLD) {
            await db.auditLog.create({
                data: {
                    actorKind: "system",
                    actorId: "indexer-cursor-reconciler",
                    action: "indexer_lag_warning",
                    targetKind: "indexer_cursor",
                    targetId: `${c.source}:${addressHex}`,
                    payloadJsonb: {
                        lagBlocks: lag.toString(),
                        chainHeadBlock: head.toString(),
                        lastIndexedBlock: lastIndexed.toString(),
                    },
                },
            });
        }
    }

    return reports;
}
