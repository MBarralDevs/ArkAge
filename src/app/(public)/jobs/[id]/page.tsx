import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { JobStatusBadge } from "@/components/primitives/job-status-badge";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { Address } from "@/components/primitives/address";
import { TxLink } from "@/components/primitives/tx-link";
import { LifecycleStrip } from "@/components/jobs/lifecycle-strip";
import { EvaluatorPanel } from "@/components/jobs/evaluator-panel";
import { WorkflowStreamViewer } from "@/components/jobs/workflow-stream-viewer";
import { PolicyDecisionsPanel } from "@/components/jobs/policy-decisions-panel";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function JobDetail({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) notFound();

    const job = await db.job.findUnique({
        where: { jobId: id },
        include: {
            events: { orderBy: { blockTime: "asc" } },
            evaluations: { orderBy: { createdAt: "desc" }, take: 1 },
            clientAgent: { select: { agentId: true } },
            providerAgent: { select: { agentId: true } },
        },
    });
    if (!job) notFound();

    const evaluation = job.evaluations[0]
        ? {
              model: job.evaluations[0].model,
              tier: job.evaluations[0].tier,
              inputTokens: job.evaluations[0].inputTokens,
              outputTokens: job.evaluations[0].outputTokens,
              costUsd: job.evaluations[0].costUsd?.toString() ?? null,
              verdict: job.evaluations[0].verdict,
              score: job.evaluations[0].score,
              reasoningText: job.evaluations[0].reasoningText,
              evidenceUri: job.evaluations[0].evidenceUri,
              evidenceHash:
                  "0x" +
                  Buffer.from(job.evaluations[0].evidenceHash).toString("hex"),
          }
        : null;

    const evalRun = await db.workflowRun.findFirst({
        where: { kind: "evaluator", kindId: BigInt(id) },
        orderBy: { startedAt: "desc" },
    });

    const evaluatorAddrHex =
        "0x" + Buffer.from(job.evaluatorAddress).toString("hex");
    const hookAddrHex = "0x" + Buffer.from(job.hookAddress).toString("hex");

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="font-mono text-2xl font-semibold">
                        Job #{job.jobId.toString()}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <JobStatusBadge status={job.status} />
                        <span>
                            Budget:{" "}
                            <MoneyDisplay
                                raw={job.budget?.toString() ?? null}
                            />
                        </span>
                        <span>
                            Expires: {job.expiredAt.toLocaleString()}
                        </span>
                    </div>
                </div>
                <Link
                    href={`https://testnet.arcscan.app/address/${hookAddrHex}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline-offset-4 hover:underline"
                >
                    View hook on Arcscan ↗
                </Link>
            </header>

            <LifecycleStrip
                status={job.status}
                events={job.events.map((e) => ({
                    eventKind: e.eventKind,
                    blockTime: e.blockTime.toISOString(),
                }))}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-base">Parties</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div>
                            <span className="text-muted-foreground">
                                Client agent:{" "}
                            </span>
                            {job.clientAgent ? (
                                <Link
                                    href={`/agents/${job.clientAgent.agentId}`}
                                    className="font-mono hover:underline"
                                >
                                    #{job.clientAgent.agentId.toString()}
                                </Link>
                            ) : (
                                "—"
                            )}
                        </div>
                        <div>
                            <span className="text-muted-foreground">
                                Provider agent:{" "}
                            </span>
                            {job.providerAgent ? (
                                <Link
                                    href={`/agents/${job.providerAgent.agentId}`}
                                    className="font-mono hover:underline"
                                >
                                    #{job.providerAgent.agentId.toString()}
                                </Link>
                            ) : (
                                "—"
                            )}
                        </div>
                        <Separator />
                        <div>
                            <span className="text-muted-foreground">
                                Evaluator:{" "}
                            </span>
                            <Address value={evaluatorAddrHex} />
                        </div>
                        <div>
                            <span className="text-muted-foreground">
                                Hook:{" "}
                            </span>
                            <Address value={hookAddrHex} />
                        </div>
                    </CardContent>
                </Card>

                <div className="md:col-span-2">
                    <EvaluatorPanel
                        evaluation={evaluation}
                        evaluatorAddress={evaluatorAddrHex}
                        evaluatorFee={job.evaluatorFee?.toString() ?? null}
                        jobId={id}
                    />
                </div>
            </div>

            {evalRun && <WorkflowStreamViewer runId={evalRun.runId} />}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        On-chain events
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {job.events.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No events indexed yet.
                        </p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {job.events.map((e) => (
                                <li
                                    key={e.id.toString()}
                                    className="flex flex-wrap items-center gap-3 border-b border-border/30 pb-2 last:border-b-0"
                                >
                                    <span className="font-mono text-xs uppercase text-muted-foreground">
                                        {e.eventKind}
                                    </span>
                                    <Address
                                        value={
                                            "0x" +
                                            Buffer.from(
                                                e.actorAddress,
                                            ).toString("hex")
                                        }
                                    />
                                    <TxLink
                                        hash={
                                            "0x" +
                                            Buffer.from(e.txHash).toString(
                                                "hex",
                                            )
                                        }
                                    />
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        {e.blockTime.toLocaleString()}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <PolicyDecisionsPanel jobId={id} />
        </div>
    );
}
