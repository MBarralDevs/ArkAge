import { db } from "@/lib/db";
import { DataRow } from "@/components/terminal/data-row";
import { TerminalPanel } from "@/components/terminal/terminal-panel";

/**
 * Replacement for the v1 StatsCards. Renders the same five metrics as
 * dense terminal data rows so they read as a live protocol-pulse block
 * instead of decorative card grid.
 */
async function load() {
    const since24h = new Date(Date.now() - 86400_000);
    const [
        activeJobs,
        agentsRegistered,
        anchoredAgents,
        jobsCompletedToday,
        x402Calls24h,
        volume24hAgg,
        openDisputes,
    ] = await Promise.all([
        db.job.count({
            where: { status: { in: ["open", "funded", "submitted"] } },
        }),
        db.agent.count({ where: { active: true } }),
        db.agent.count({
            where: { active: true, chainAgentId: { not: null } },
        }),
        db.job.count({
            where: {
                status: "completed",
                completedAtBlock: { not: null },
                updatedAt: { gte: since24h },
            },
        }),
        db.x402Receipt.count({ where: { createdAt: { gte: since24h } } }),
        db.job.aggregate({
            where: { status: "completed", updatedAt: { gte: since24h } },
            _sum: { budget: true },
        }),
        db.x402Dispute.count({ where: { status: "open" } }),
    ]);
    return {
        activeJobs,
        agentsRegistered,
        anchoredAgents,
        jobsCompletedToday,
        x402Calls24h,
        volumeRaw: volume24hAgg._sum.budget?.toString() ?? "0",
        openDisputes,
    };
}

function rawUsdc(raw: string): string {
    const big = BigInt(raw);
    const whole = big / 1_000_000n;
    const frac =
        (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") ||
        "0";
    return `$${whole}.${frac}`;
}

export async function ProtocolPulse() {
    const s = await load();
    return (
        <TerminalPanel label="PROTOCOL PULSE / 24H" bare>
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                <dl className="px-4 py-3">
                    <DataRow
                        label="Agents registered"
                        value={s.agentsRegistered.toLocaleString()}
                        accent
                    />
                    <DataRow
                        label="On-chain anchored"
                        value={s.anchoredAgents.toLocaleString()}
                    />
                    <DataRow
                        label="Active jobs"
                        value={s.activeJobs.toLocaleString()}
                    />
                    <DataRow
                        label="Open disputes"
                        value={s.openDisputes.toLocaleString()}
                    />
                </dl>
                <dl className="px-4 py-3">
                    <DataRow
                        label="Jobs settled · 24h"
                        value={s.jobsCompletedToday.toLocaleString()}
                    />
                    <DataRow
                        label="x402 calls · 24h"
                        value={s.x402Calls24h.toLocaleString()}
                        accent
                    />
                    <DataRow
                        label="Volume · 24h"
                        value={rawUsdc(s.volumeRaw)}
                    />
                    <DataRow
                        label="Last refresh"
                        value={new Date().toLocaleTimeString("en-US", {
                            hour12: false,
                        })}
                    />
                </dl>
            </div>
        </TerminalPanel>
    );
}
