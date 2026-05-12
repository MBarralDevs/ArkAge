import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { IdentityCard } from "@/components/agents/identity-card";
import { ReputationDistribution } from "@/components/agents/reputation-distribution";
import { ReputationTimeseries } from "@/components/agents/reputation-timeseries";
import { JobHistoryTable } from "@/components/agents/job-history-table";
import { X402EndpointsList } from "@/components/agents/x402-endpoints-list";

export const dynamic = "force-dynamic";

function bucketize(scores: number[]): Array<{ bucket: string; count: number }> {
    const buckets = ["≤-50", "-49…-1", "0", "1…49", "50…100"];
    const counts = [0, 0, 0, 0, 0];
    for (const s of scores) {
        if (s <= -50) counts[0]!++;
        else if (s < 0) counts[1]!++;
        else if (s === 0) counts[2]!++;
        else if (s < 50) counts[3]!++;
        else counts[4]!++;
    }
    return buckets.map((b, i) => ({ bucket: b, count: counts[i]! }));
}

export default async function AgentProfile({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) notFound();

    const agent = await db.agent.findUnique({
        where: { agentId: id },
        include: {
            currentOperatorWallet: true,
            metadata: { orderBy: { createdAt: "desc" }, take: 1 },
            reputationFeedback: { orderBy: { createdAt: "asc" } },
            x402Endpoints: { where: { active: true } },
        },
    });
    if (!agent) notFound();

    const scores = agent.reputationFeedback.map((r) => r.score ?? 0);
    const series = agent.reputationFeedback.reduce<
        { ts: string; score: number; running: number; n: number }[]
    >((acc, r) => {
        const last = acc[acc.length - 1];
        const n = (last?.n ?? 0) + 1;
        const running =
            ((last?.running ?? 0) * (n - 1) + (r.score ?? 0)) / n;
        acc.push({
            ts: r.createdAt.toISOString(),
            score: Math.round(running * 10) / 10,
            running,
            n,
        });
        return acc;
    }, []);

    const [asClient, asProvider] = await Promise.all([
        db.job.findMany({
            where: { clientAgentId: agent.id },
            include: { providerAgent: { select: { agentId: true } } },
            orderBy: { createdAt: "desc" },
            take: 25,
        }),
        db.job.findMany({
            where: { providerAgentId: agent.id },
            include: { clientAgent: { select: { agentId: true } } },
            orderBy: { createdAt: "desc" },
            take: 25,
        }),
    ]);

    const m = agent.metadata[0]?.metadataJsonb as
        | {
              name?: string;
              description?: string;
              capabilities?: string[];
              version?: string;
          }
        | undefined;

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <IdentityCard
                agentId={agent.agentId.toString()}
                identityOwner={
                    "0x" + Buffer.from(agent.identityOwnerWallet).toString("hex")
                }
                operator={
                    "0x" +
                    Buffer.from(agent.currentOperatorWallet.address).toString(
                        "hex",
                    )
                }
                active={agent.active}
                metadata={m ?? null}
                custody={agent.currentOperatorWallet.custody}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReputationDistribution data={bucketize(scores)} />
                <ReputationTimeseries
                    data={series.map((s) => ({ ts: s.ts, score: s.score }))}
                />
            </div>

            <JobHistoryTable
                asClient={asClient.map((j) => ({
                    jobId: j.jobId.toString(),
                    status: j.status,
                    budget: j.budget?.toString() ?? null,
                    counterparty:
                        j.providerAgent?.agentId?.toString() ?? null,
                }))}
                asProvider={asProvider.map((j) => ({
                    jobId: j.jobId.toString(),
                    status: j.status,
                    budget: j.budget?.toString() ?? null,
                    counterparty: j.clientAgent?.agentId?.toString() ?? null,
                }))}
            />

            <X402EndpointsList
                endpoints={agent.x402Endpoints.map((e) => ({
                    id: e.id.toString(),
                    url: e.effectiveUrl,
                    pricePerCall: e.pricePerCall.toString(),
                    hosting: e.hosting,
                    active: e.active,
                }))}
            />
        </div>
    );
}
