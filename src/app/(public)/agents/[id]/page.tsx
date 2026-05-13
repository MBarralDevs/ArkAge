import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { IdentityCard } from "@/components/agents/identity-card";
import { ShareAgentButton } from "@/components/agents/share-agent-button";
import { ReputationDistribution } from "@/components/agents/reputation-distribution";
import { ReputationTimeseries } from "@/components/agents/reputation-timeseries";
import { ReputationByEvaluator } from "@/components/agents/reputation-by-evaluator";
import { ReputationFreshnessBadge } from "@/components/agents/reputation-freshness-badge";
import { ReputationDiversityBadge } from "@/components/agents/reputation-diversity-badge";
import { JobHistoryTable } from "@/components/agents/job-history-table";
import { X402EndpointsList } from "@/components/agents/x402-endpoints-list";
import { DisputesSection } from "@/components/agents/disputes-section";
import { loadAgentReputation } from "@/lib/reputation-stats";
import { loadAgentDisputes } from "@/lib/disputes-stats";

export const dynamic = "force-dynamic";

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
            x402Endpoints: { where: { active: true } },
        },
    });
    if (!agent) notFound();

    const [stats, disputeStats] = await Promise.all([
        loadAgentReputation(agent.id),
        loadAgentDisputes(agent.id),
    ]);

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
            <div className="flex justify-end">
                <ShareAgentButton agentId={agent.agentId.toString()} />
            </div>
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
                chainAgentId={agent.chainAgentId}
                identityRegisterTxHash={agent.identityRegisterTxHash}
            />

            <section className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Trust signals:</span>
                <ReputationFreshnessBadge freshness={stats.freshness} />
                <ReputationDiversityBadge diversity={stats.diversity} />
                <span className="ml-2">
                    {stats.total} feedback event
                    {stats.total === 1 ? "" : "s"}
                    {stats.averageScore != null
                        ? ` · avg ${stats.averageScore.toFixed(2)}`
                        : ""}
                </span>
            </section>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReputationDistribution data={stats.distribution} />
                <ReputationTimeseries
                    data={stats.timeseries.map((s) => ({
                        ts: s.ts,
                        score: s.runningAverage,
                    }))}
                />
            </div>

            <ReputationByEvaluator rows={stats.byEvaluator} />

            <DisputesSection stats={disputeStats} />

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
