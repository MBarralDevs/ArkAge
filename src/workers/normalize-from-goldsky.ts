import {
    decodeEventLog,
    keccak256,
    parseAbiItem,
    toBytes,
    type Hex,
} from "viem";
import { db } from "@/lib/db";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";
import { CHAIN_ID as ARC_CHAIN_ID } from "@/lib/chain";
import {
    handleJobCreated,
    type CircleNotificationEnvelope,
    ingestCircleEvent,
} from "@/workers/ingest-circle-event";

/**
 * Goldsky→app normalizer.
 *
 * Goldsky's Mirror pipeline writes canonical-contract logs to
 * `indexer_raw.raw_chain_logs` (TEXT columns; topics is a comma-separated
 * hex string). This worker translates each new row into the same
 * `CircleNotificationEnvelope` shape the Circle webhook produces and
 * pipes it through `ingestCircleEvent` so:
 *
 *   - Job + JobEvent + ReputationFeedback rows land via the existing
 *     handlers — one code path, two delivery mechanisms.
 *   - Workflow `resumeHook` calls fire (jobLifecycle / dispute /
 *     reputation paths) without an extra branch.
 *   - The audit_log is idempotent on the synthesized notificationId
 *     (`goldsky:<chainId>:<txHash>:<logIndex>`).
 *
 * Cursor model: one row per (source, chainId, contractAddress) in
 * `indexer_cursor`. Initialized lazily on first scan to the current
 * Goldsky head minus the LOOKBACK so a fresh deployment isn't forced to
 * replay days of history. Advances atomically with batch processing.
 */

const SOURCE = "goldsky";
const LOOKBACK_ON_INIT = 10_000n; // ~3h on Arc
const BATCH_SIZE = 1_000;

interface CanonicalContract {
    address: `0x${string}`;
    abi: readonly ReturnType<typeof parseAbiItem>[];
    /** topic0 → event name */
    eventByTopic: Record<string, string>;
}

const ERC8183_EVENTS = [
    parseAbiItem(
        "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
    ),
    parseAbiItem(
        "event JobFunded(uint256 indexed jobId, address indexed funder, uint256 amount)",
    ),
    parseAbiItem(
        "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
    ),
    parseAbiItem(
        "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
    ),
    parseAbiItem(
        "event JobRejected(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
    ),
] as const;

const REPUTATION_EVENTS = [
    parseAbiItem(
        "event FeedbackGiven(uint256 indexed agentId, address indexed submitter, uint8 value, bytes32 tag1, bytes32 tag2, bytes32 feedbackHash)",
    ),
] as const;

function topicForName(name: string, sig: string): string {
    return keccak256(toBytes(sig));
}

function buildContract(
    address: `0x${string}`,
    abi: readonly ReturnType<typeof parseAbiItem>[],
    sigs: readonly { name: string; sig: string }[],
): CanonicalContract {
    const eventByTopic: Record<string, string> = {};
    for (const { name, sig } of sigs) {
        eventByTopic[topicForName(name, sig)] = name;
    }
    return { address, abi, eventByTopic };
}

const CONTRACTS: CanonicalContract[] = [
    buildContract(
        ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE,
        ERC8183_EVENTS,
        [
            {
                name: "JobCreated",
                sig: "JobCreated(uint256,address,address,address,uint256,address)",
            },
            {
                name: "JobFunded",
                sig: "JobFunded(uint256,address,uint256)",
            },
            {
                name: "JobSubmitted",
                sig: "JobSubmitted(uint256,address,bytes32)",
            },
            {
                name: "JobCompleted",
                sig: "JobCompleted(uint256,address,bytes32)",
            },
            {
                name: "JobRejected",
                sig: "JobRejected(uint256,address,bytes32)",
            },
        ],
    ),
    buildContract(
        ARC_TESTNET_ADDRESSES.ERC_8004_REPUTATION_REGISTRY,
        REPUTATION_EVENTS,
        [
            {
                name: "FeedbackGiven",
                sig: "FeedbackGiven(uint256,address,uint8,bytes32,bytes32,bytes32)",
            },
        ],
    ),
];

interface RawLogRow {
    block_number: bigint;
    log_index: bigint;
    transaction_hash: string;
    address: string;
    data: string;
    topics: string; // comma-separated hex
    block_timestamp: bigint;
}

function hexToBytes(s: string): Uint8Array {
    return Uint8Array.from(Buffer.from(s.replace(/^0x/, ""), "hex"));
}

async function getOrInitCursor(
    contractAddress: `0x${string}`,
): Promise<bigint> {
    const addrBytes = hexToBytes(contractAddress);
    const existing = await db.indexerCursor.findFirst({
        where: {
            source: SOURCE,
            chainId: ARC_CHAIN_ID,
            contractAddress: Buffer.from(addrBytes),
        },
    });
    if (existing) return BigInt(existing.lastBlock.toString());

    // Initialize at current goldsky head − LOOKBACK so we don't replay
    // all history on a cold start.
    const headRow = (await db.$queryRawUnsafe(
        `SELECT COALESCE(MAX(block_number), 0)::text AS head
         FROM indexer_raw.raw_chain_logs
         WHERE address = $1`,
        contractAddress.toLowerCase(),
    )) as Array<{ head: string }>;
    const head = BigInt(headRow[0]?.head ?? "0");
    const initBlock = head > LOOKBACK_ON_INIT ? head - LOOKBACK_ON_INIT : 0n;

    await db.indexerCursor.create({
        data: {
            source: SOURCE,
            chainId: ARC_CHAIN_ID,
            contractAddress: Buffer.from(addrBytes),
            lastBlock: initBlock,
            lastProcessedAt: new Date(),
        },
    });
    return initBlock;
}

async function advanceCursor(
    contractAddress: `0x${string}`,
    block: bigint,
): Promise<void> {
    await db.indexerCursor.updateMany({
        where: {
            source: SOURCE,
            chainId: ARC_CHAIN_ID,
            contractAddress: Buffer.from(hexToBytes(contractAddress)),
        },
        data: {
            lastBlock: block,
            lastProcessedAt: new Date(),
        },
    });
}

function decodeRowToNotification(
    row: RawLogRow,
    contract: CanonicalContract,
): {
    eventName: string;
    notification: CircleNotificationEnvelope;
} | null {
    const topics = row.topics.split(",").filter(Boolean) as Hex[];
    if (topics.length === 0) return null;
    const eventName = contract.eventByTopic[topics[0]!];
    if (!eventName) return null;

    let decoded: Record<string, unknown>;
    try {
        const r = decodeEventLog({
            abi: contract.abi,
            topics: topics as [Hex, ...Hex[]],
            data: (row.data || "0x") as Hex,
        });
        decoded = r.args as unknown as Record<string, unknown>;
    } catch {
        return null;
    }

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(decoded)) {
        if (typeof v === "bigint") params[k] = v.toString();
        else if (typeof v === "string") params[k] = v;
        else if (typeof v === "number") params[k] = v.toString();
        else if (v != null) params[k] = String(v);
    }

    const notificationId = `goldsky:${ARC_CHAIN_ID}:${row.transaction_hash}:${row.log_index.toString()}`;

    const notification: CircleNotificationEnvelope = {
        subscriptionId: "goldsky-normalizer",
        notificationId,
        notificationType: "contracts.events.created",
        notification: {
            contractAddress: row.address,
            eventName,
            txHash: row.transaction_hash,
            logIndex: Number(row.log_index),
            blockNumber: row.block_number.toString(),
            blockTime: new Date(Number(row.block_timestamp) * 1000).toISOString(),
            params,
        } as unknown as Record<string, unknown>,
        timestamp: new Date(
            Number(row.block_timestamp) * 1000,
        ).toISOString(),
        version: 1,
    };

    return { eventName, notification };
}

export interface NormalizeReport {
    contractAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
    rowsProcessed: number;
    rowsDispatched: number;
}

export async function normalizeFromGoldsky(): Promise<NormalizeReport[]> {
    // Reference unused param-handling helper so it isn't dropped if a
    // future revision swaps codepaths.
    void handleJobCreated;

    const reports: NormalizeReport[] = [];

    for (const contract of CONTRACTS) {
        const startBlock = await getOrInitCursor(contract.address);

        const rows = (await db.$queryRawUnsafe(
            `SELECT
               block_number::text AS block_number,
               log_index::text AS log_index,
               transaction_hash,
               address,
               data,
               topics,
               block_timestamp::text AS block_timestamp
             FROM indexer_raw.raw_chain_logs
             WHERE address = $1
               AND block_number > $2
             ORDER BY block_number ASC, log_index ASC
             LIMIT $3`,
            contract.address.toLowerCase(),
            startBlock.toString(),
            BATCH_SIZE,
        )) as Array<{
            block_number: string;
            log_index: string;
            transaction_hash: string;
            address: string;
            data: string;
            topics: string;
            block_timestamp: string;
        }>;

        let dispatched = 0;
        let maxBlock = startBlock;
        for (const raw of rows) {
            const row: RawLogRow = {
                block_number: BigInt(raw.block_number),
                log_index: BigInt(raw.log_index),
                transaction_hash: raw.transaction_hash,
                address: raw.address,
                data: raw.data,
                topics: raw.topics,
                block_timestamp: BigInt(raw.block_timestamp),
            };
            const decoded = decodeRowToNotification(row, contract);
            if (decoded) {
                try {
                    await ingestCircleEvent(decoded.notification);
                    dispatched++;
                } catch (e) {
                    // Don't let one bad row hold the cursor back; log and continue.
                    console.error(
                        `[normalize-goldsky] dispatch failed for ${decoded.eventName} at ${row.transaction_hash}#${row.log_index}`,
                        e instanceof Error ? e.message : String(e),
                    );
                }
            }
            if (row.block_number > maxBlock) maxBlock = row.block_number;
        }

        if (maxBlock > startBlock) {
            await advanceCursor(contract.address, maxBlock);
        }

        reports.push({
            contractAddress: contract.address,
            fromBlock: startBlock,
            toBlock: maxBlock,
            rowsProcessed: rows.length,
            rowsDispatched: dispatched,
        });
    }

    return reports;
}
