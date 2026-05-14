import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { JobStatusBadge } from "@/components/primitives/job-status-badge";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { Address } from "@/components/primitives/address";
import { TxLink } from "@/components/primitives/tx-link";
import { addressLink } from "@/lib/chain";
import { LifecycleStrip } from "@/components/jobs/lifecycle-strip";
import { EvaluatorPanel } from "@/components/jobs/evaluator-panel";
import { WorkflowStreamViewer } from "@/components/jobs/workflow-stream-viewer";
import { PolicyDecisionsPanel } from "@/components/jobs/policy-decisions-panel";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";
import { DataRow } from "@/components/terminal/data-row";

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
            <header className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── Job detail ─ /jobs/{job.jobId.toString()} ──
                </p>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="space-y-2">
                        <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                            Job{" "}
                            <span className="text-primary">
                                #{job.jobId.toString()}
                            </span>
                        </h1>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                            <JobStatusBadge status={job.status} />
                            <span className="text-muted-foreground">
                                <span className="uppercase tracking-[0.18em]">
                                    budget
                                </span>{" "}
                                <MoneyDisplay
                                    raw={job.budget?.toString() ?? null}
                                />
                            </span>
                            <span className="text-muted-foreground">
                                <span className="uppercase tracking-[0.18em]">
                                    expires
                                </span>{" "}
                                {job.expiredAt.toLocaleString()}
                            </span>
                        </div>
                    </div>
                    <Link
                        href={addressLink(hookAddrHex)}
                        target="_blank"
                        rel="noreferrer"
                        className="border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                        [hook&nbsp;on&nbsp;arcscan&nbsp;↗]
                    </Link>
                </div>
            </header>

            <LifecycleStrip
                status={job.status}
                events={job.events.map((e) => ({
                    eventKind: e.eventKind,
                    blockTime: e.blockTime.toISOString(),
                }))}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <TerminalPanel label="PARTIES" className="md:col-span-1">
                    <dl>
                        <DataRow
                            label="Client"
                            value={
                                job.clientAgent ? (
                                    <Link
                                        href={`/agents/${job.clientAgent.agentId}`}
                                        className="text-primary hover:underline"
                                    >
                                        #{job.clientAgent.agentId.toString()}
                                    </Link>
                                ) : (
                                    "—"
                                )
                            }
                        />
                        <DataRow
                            label="Provider"
                            value={
                                job.providerAgent ? (
                                    <Link
                                        href={`/agents/${job.providerAgent.agentId}`}
                                        className="text-primary hover:underline"
                                    >
                                        #
                                        {job.providerAgent.agentId.toString()}
                                    </Link>
                                ) : (
                                    "—"
                                )
                            }
                        />
                        <DataRow
                            label="Evaluator"
                            value={<Address value={evaluatorAddrHex} />}
                        />
                        <DataRow
                            label="Hook"
                            value={<Address value={hookAddrHex} />}
                        />
                    </dl>
                </TerminalPanel>

                <div className="md:col-span-2">
                    <EvaluatorPanel
                        evaluation={evaluation}
                        evaluatorAddress={evaluatorAddrHex}
                        evaluatorFee={job.evaluatorFee?.toString() ?? null}
                        jobId={id}
                    />
                </div>
            </div>

            {evalRun && (
                <>
                    <AsciiDivider label="WORKFLOW STREAM" />
                    <WorkflowStreamViewer runId={evalRun.runId} />
                </>
            )}

            <AsciiDivider label="ON-CHAIN EVENTS" />
            <TerminalPanel label={`EVENT LOG / ${job.events.length}`} bare>
                {job.events.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        No events indexed yet
                    </p>
                ) : (
                    <ul className="divide-y divide-border/40">
                        {job.events.map((e) => (
                            <li
                                key={e.id.toString()}
                                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-2 text-xs"
                            >
                                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
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
                                        Buffer.from(e.txHash).toString("hex")
                                    }
                                />
                                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                    {e.blockTime.toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </TerminalPanel>

            <PolicyDecisionsPanel jobId={id} />
        </div>
    );
}
