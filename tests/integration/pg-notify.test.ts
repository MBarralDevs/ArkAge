import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { listenToChannel } from "@/lib/pg-notify";

describe("pg-notify", () => {
    const cleanup: Array<() => Promise<void>> = [];

    afterAll(async () => {
        for (const c of cleanup) await c();
        await db.$disconnect();
    });

    it("delivers a notification when triggered by job_events insert", async () => {
        const received: Array<{ jobId: string }> = [];
        const stop = await listenToChannel<{ jobId: string }>(
            "arkage:jobs",
            (payload) => {
                received.push(payload);
            },
        );
        cleanup.push(stop);

        // Insert a fake job + event row to fire the trigger.
        const rand = Math.floor(Math.random() * 1_000_000_000);
        const wallet = await db.wallet.create({
            data: {
                address: Buffer.from(rand.toString(16).padStart(40, "0"), "hex"),
                tier: 2,
                custody: "dcw",
                accountType: "eoa",
            },
        });
        const agent = await db.agent.create({
            data: {
                agentId: rand.toString(),
                identityOwnerWallet: Buffer.from("cd".repeat(20), "hex"),
                currentOperatorWalletId: wallet.id,
                agentWalletAddress: Buffer.from(
                    rand.toString(16).padStart(40, "0"),
                    "hex",
                ),
                registeredAtBlock: 1n,
            },
        });
        const job = await db.job.create({
            data: {
                jobId: rand.toString(),
                clientAgentId: agent.id,
                evaluatorAddress: Buffer.from("ee".repeat(20), "hex"),
                status: "open",
                hookAddress: Buffer.from("ff".repeat(20), "hex"),
                expiredAt: new Date(Date.now() + 3600_000),
            },
        });
        await db.jobEvent.create({
            data: {
                jobId: job.id,
                eventKind: "created",
                actorAddress: Buffer.from("ee".repeat(20), "hex"),
                chainId: 5042002,
                txHash: Buffer.from(
                    rand.toString(16).padStart(64, "0"),
                    "hex",
                ),
                logIndex: 0,
                blockNumber: BigInt(rand),
                blockTime: new Date(),
            },
        });

        await new Promise((r) => setTimeout(r, 1500));
        expect(received.length).toBeGreaterThan(0);

        await db.jobEvent.deleteMany({ where: { jobId: job.id } });
        await db.job.delete({ where: { id: job.id } });
        await db.agent.delete({ where: { id: agent.id } });
        await db.wallet.delete({ where: { id: wallet.id } });
    }, 15_000);
});
