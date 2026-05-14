/**
 * One-shot backfill of ERC-8183 jobs into Postgres.
 *
 * The Goldsky Mirror pipeline (`indexer/goldsky/arkage-canonical.yaml`)
 * drops raw chain logs into `indexer_raw.raw_chain_logs`, but there is no
 * normalizer that promotes those into the application-level `jobs` table.
 * Until that normalizer ships, this script reads canonical events
 * directly via viem and feeds them through the same `routeContractEvent`
 * path the webhook worker uses — so the Job row, JobEvent rows, and
 * status field all land consistently.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-jobs.ts [fromBlock]
 *
 * If `fromBlock` is omitted, defaults to the last 100k blocks (~24h on Arc).
 */

import {
    createPublicClient,
    decodeEventLog,
    http,
    keccak256,
    parseAbi,
    parseAbiItem,
    toBytes,
    type Address,
    type Hex,
    type Log,
} from "viem";
import { db } from "../src/lib/db";
import { arcTestnet, CHAIN_ID as ARC_CHAIN_ID } from "../src/lib/chain";
import { env } from "../src/lib/env";
import { ARC_TESTNET_ADDRESSES } from "../src/lib/addresses";
import { handleJobCreated } from "../src/workers/ingest-circle-event";

const ERC8183 = ARC_TESTNET_ADDRESSES.ERC_8183_AGENTIC_COMMERCE;
const DEFAULT_LOOKBACK_BLOCKS = 100_000n;

// Canonical ERC-8183 event signatures as actually emitted on Arc Testnet
// (verified by reading live tx receipts on 2026-05-14). Each Job* event
// has TWO indexed args: jobId + the actor (client / funder / provider /
// evaluator). Description is NOT in the event.
const events = {
    JobCreated: parseAbiItem(
        "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
    ),
    JobFunded: parseAbiItem(
        "event JobFunded(uint256 indexed jobId, address indexed funder, uint256 amount)",
    ),
    JobSubmitted: parseAbiItem(
        "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
    ),
    JobCompleted: parseAbiItem(
        "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
    ),
    JobRejected: parseAbiItem(
        "event JobRejected(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
    ),
};

const TOPICS = {
    JobCreated: keccak256(
        toBytes(
            "JobCreated(uint256,address,address,address,uint256,address)",
        ),
    ),
    JobFunded: keccak256(toBytes("JobFunded(uint256,address,uint256)")),
    JobSubmitted: keccak256(
        toBytes("JobSubmitted(uint256,address,bytes32)"),
    ),
    JobCompleted: keccak256(
        toBytes("JobCompleted(uint256,address,bytes32)"),
    ),
    JobRejected: keccak256(
        toBytes("JobRejected(uint256,address,bytes32)"),
    ),
};

const pub = createPublicClient({
    chain: arcTestnet,
    transport: http(env.ARC_TESTNET_RPC_HTTP),
});

function statusFromEvent(name: string): string {
    switch (name) {
        case "JobCreated":
            return "open";
        case "JobFunded":
            return "funded";
        case "JobSubmitted":
            return "submitted";
        case "JobCompleted":
            return "completed";
        case "JobRejected":
            return "rejected";
        default:
            return "open";
    }
}

function bytesFromHex(hex: string) {
    return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

async function fetchLogsChunked(
    fromBlock: bigint,
    toBlock: bigint,
    topic: Hex,
): Promise<Log[]> {
    // Arc RPC caps eth_getLogs ranges; chunk to be safe.
    const CHUNK = 5_000n;
    const out: Log[] = [];
    for (let b = fromBlock; b <= toBlock; b += CHUNK + 1n) {
        const end = b + CHUNK > toBlock ? toBlock : b + CHUNK;
        const part = await pub.getLogs({
            address: ERC8183,
            fromBlock: b,
            toBlock: end,
            event: undefined,
            // viem filter by topic[0]; we filter post-hoc using event sig
            // → fetch ALL logs from ERC-8183 in this range, then filter by topic[0]
        });
        for (const l of part) if (l.topics[0] === topic) out.push(l);
    }
    return out;
}

interface BlockTime {
    blockNumber: bigint;
    timestamp: number;
}

const blockTimeCache = new Map<bigint, number>();
async function getBlockTime(bn: bigint): Promise<number> {
    const cached = blockTimeCache.get(bn);
    if (cached !== undefined) return cached;
    const blk = await pub.getBlock({ blockNumber: bn });
    const ts = Number(blk.timestamp);
    blockTimeCache.set(bn, ts);
    return ts;
}

interface Decoded {
    jobId: bigint;
    blockNumber: bigint;
    logIndex: number;
    txHash: Hex;
    eventName: keyof typeof events;
    params: Record<string, unknown>;
}

async function decodeLogs(
    logs: Log[],
    name: keyof typeof events,
): Promise<Decoded[]> {
    const out: Decoded[] = [];
    for (const log of logs) {
        try {
            const dec = decodeEventLog({
                abi: [events[name]],
                topics: log.topics,
                data: log.data,
            });
            const args = dec.args as Record<string, unknown>;
            out.push({
                jobId: args.jobId as bigint,
                blockNumber: log.blockNumber!,
                logIndex: log.logIndex!,
                txHash: log.transactionHash! as Hex,
                eventName: name,
                params: args,
            });
        } catch (e) {
            console.error(`failed to decode ${name} log`, e);
        }
    }
    return out;
}

function paramsToStringRecord(
    p: Record<string, unknown>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) {
        if (typeof v === "bigint") out[k] = v.toString();
        else if (typeof v === "string") out[k] = v;
        else if (v != null) out[k] = String(v);
    }
    return out;
}

async function main() {
    const head = await pub.getBlockNumber();
    const argFrom = process.argv[2] ? BigInt(process.argv[2]) : undefined;
    const fromBlock =
        argFrom ?? (head > DEFAULT_LOOKBACK_BLOCKS ? head - DEFAULT_LOOKBACK_BLOCKS : 0n);
    const toBlock = head;

    console.log(`Scanning ERC-8183 logs ${fromBlock} → ${toBlock} (chunk 5k)`);

    const allLogs: Decoded[] = [];
    for (const name of [
        "JobCreated",
        "JobFunded",
        "JobSubmitted",
        "JobCompleted",
        "JobRejected",
    ] as const) {
        const raw = await fetchLogsChunked(fromBlock, toBlock, TOPICS[name]);
        const decoded = await decodeLogs(raw, name);
        console.log(`  ${name}: ${decoded.length}`);
        allLogs.push(...decoded);
    }

    allLogs.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber)
            return a.blockNumber < b.blockNumber ? -1 : 1;
        return a.logIndex - b.logIndex;
    });

    let createdCount = 0;
    let skippedCreated = 0;
    let eventCount = 0;
    let statusChanges = 0;

    for (const d of allLogs) {
        const blockTime = await getBlockTime(d.blockNumber);
        const notif = {
            contractAddress: ERC8183.toLowerCase(),
            eventName: d.eventName,
            txHash: d.txHash,
            logIndex: d.logIndex,
            blockNumber: d.blockNumber.toString(),
            blockTime: new Date(blockTime * 1000).toISOString(),
            params: paramsToStringRecord(d.params),
        };

        if (d.eventName === "JobCreated") {
            const existed = await db.job.findUnique({
                where: { jobId: d.jobId.toString() },
                select: { id: true },
            });
            if (existed) {
                skippedCreated++;
                continue;
            }
            await handleJobCreated(notif);
            const after = await db.job.findUnique({
                where: { jobId: d.jobId.toString() },
                select: { id: true },
            });
            if (after) createdCount++;
            else skippedCreated++;
            continue;
        }

        // Funded/Submitted/Completed/Rejected: write JobEvent + update status.
        const job = await db.job.findUnique({
            where: { jobId: d.jobId.toString() },
        });
        if (!job) continue;

        const newStatus = statusFromEvent(d.eventName);
        // Don't regress status (e.g. older funded after a later submitted).
        const order: Record<string, number> = {
            open: 0,
            funded: 1,
            submitted: 2,
            completed: 3,
            rejected: 3,
            expired: 3,
        };
        const cur = order[job.status] ?? 0;
        const next = order[newStatus] ?? 0;

        await db.jobEvent
            .upsert({
                where: {
                    chainId_txHash_logIndex: {
                        chainId: ARC_CHAIN_ID,
                        txHash: bytesFromHex(d.txHash),
                        logIndex: d.logIndex,
                    },
                },
                update: {},
                create: {
                    jobId: job.id,
                    eventKind: newStatus,
                    actorAddress: bytesFromHex(ERC8183),
                    payloadJsonb: notif.params as object,
                    chainId: ARC_CHAIN_ID,
                    txHash: bytesFromHex(d.txHash),
                    logIndex: d.logIndex,
                    blockNumber: d.blockNumber,
                    blockTime: new Date(blockTime * 1000),
                },
            })
            .then(() => eventCount++)
            .catch(() => {});

        if (next > cur) {
            const data: Record<string, unknown> = { status: newStatus };
            if (d.eventName === "JobFunded" && d.params.amount) {
                data.budget = (d.params.amount as bigint).toString();
            }
            if (
                (d.eventName === "JobCompleted" ||
                    d.eventName === "JobRejected") &&
                d.params.reason
            ) {
                data.reasonHash = bytesFromHex(d.params.reason as string);
                data.completedAtBlock = d.blockNumber;
            }
            await db.job.update({
                where: { id: job.id },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: data as any,
            });
            statusChanges++;
        }
    }

    console.log("");
    console.log("==== BACKFILL SUMMARY ====");
    console.log(`  JobCreated rows inserted : ${createdCount}`);
    console.log(`  JobCreated rows skipped  : ${skippedCreated} (client/provider not known to ArkAge)`);
    console.log(`  JobEvent rows inserted   : ${eventCount}`);
    console.log(`  status field updates     : ${statusChanges}`);
    const total = await db.job.count();
    const completed = await db.job.count({ where: { status: "completed" } });
    const funded = await db.job.count({ where: { status: "funded" } });
    const submitted = await db.job.count({ where: { status: "submitted" } });
    console.log("");
    console.log(`  jobs total in DB         : ${total}`);
    console.log(`  status=funded            : ${funded}`);
    console.log(`  status=submitted         : ${submitted}`);
    console.log(`  status=completed         : ${completed}`);

    await db.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await db.$disconnect().catch(() => {});
    process.exit(1);
});
