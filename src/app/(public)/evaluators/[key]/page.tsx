import { notFound } from "next/navigation";
import Link from "next/link";
import { Address } from "@/components/primitives/address";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";
import { StatusTag } from "@/components/terminal/status-tag";
import {
    loadEvaluatorDetail,
    rawUsdcToUsd,
} from "@/lib/evaluators-catalog";

export const dynamic = "force-dynamic";

/**
 * Per-evaluator detail page. URL key format: `arkage:premium` |
 * `arkage:standard` | `arkage:fast` | `byo:0x...`.
 */
export default async function EvaluatorDetailPage({
    params,
}: {
    params: Promise<{ key: string }>;
}) {
    const { key } = await params;
    // Next.js routes urlencode `:` to `%3A`; decode before passing on.
    const decoded = decodeURIComponent(key);

    const detail = await loadEvaluatorDetail(decoded);
    if (!detail) notFound();

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
            <header className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── Evaluator profile ─ /evaluators/{decoded} ──
                </p>
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                        {detail.displayName}
                    </h1>
                    <StatusTag
                        variant={
                            detail.kind === "arkage-builtin" ? "ok" : "neutral"
                        }
                        mark={detail.kind === "arkage-builtin" ? "·" : "~"}
                    >
                        {detail.kind === "arkage-builtin"
                            ? "ArkAge built-in"
                            : "BYO"}
                    </StatusTag>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Address value={detail.address} />
                    {detail.tier && (
                        <>
                            <span className="text-muted-foreground/40">│</span>
                            <span className="uppercase tracking-[0.22em]">
                                tier {detail.tier}
                            </span>
                        </>
                    )}
                </p>
            </header>

            <TerminalPanel label="ACTIVITY">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    <Stat
                        label="Jobs decided"
                        value={detail.jobsEvaluated.toString()}
                        accent
                    />
                    <Stat
                        label="Completion rate"
                        value={
                            detail.completed + detail.rejected === 0
                                ? "—"
                                : `${Math.round(detail.completionRate * 100)}%`
                        }
                        accent
                    />
                    <Stat
                        label="Avg decision time"
                        value={formatDuration(detail.averageDecisionMs)}
                    />
                    <Stat
                        label="Completed"
                        value={detail.completed.toString()}
                    />
                    <Stat
                        label="Rejected"
                        value={detail.rejected.toString()}
                    />
                    <Stat
                        label="Expired"
                        value={detail.expired.toString()}
                    />
                    <Stat
                        label="Fees earned"
                        value={`$${rawUsdcToUsd(detail.totalFeesEarnedRaw)}`}
                        accent
                    />
                    <Stat
                        label="Unique clients"
                        value={detail.uniqueClients.toString()}
                    />
                    <Stat
                        label="Unique providers"
                        value={detail.uniqueProviders.toString()}
                    />
                </dl>
            </TerminalPanel>

            <AsciiDivider label="RECENT JOBS" />

            <TerminalPanel
                label={`JOB HISTORY / ${detail.recentJobs.length}`}
                bare
            >
                {detail.recentJobs.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        No jobs decided yet
                    </p>
                ) : (
                    <ul className="divide-y divide-border/40 text-xs">
                        {detail.recentJobs.map((j) => (
                            <li
                                key={j.jobId}
                                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2"
                            >
                                <Link
                                    href={`/jobs/${j.jobId}`}
                                    className="font-mono tabular-nums text-muted-foreground transition-colors hover:text-primary hover:underline"
                                >
                                    #{j.jobId}
                                </Link>
                                <div className="text-[11px] text-muted-foreground">
                                    <Link
                                        href={`/agents/${j.clientAgentId}`}
                                        className="font-mono tabular-nums transition-colors hover:text-primary hover:underline"
                                    >
                                        #{j.clientAgentId}
                                    </Link>
                                    <span className="px-1.5 text-muted-foreground/40">
                                        →
                                    </span>
                                    {j.providerAgentId ? (
                                        <Link
                                            href={`/agents/${j.providerAgentId}`}
                                            className="font-mono tabular-nums transition-colors hover:text-primary hover:underline"
                                        >
                                            #{j.providerAgentId}
                                        </Link>
                                    ) : (
                                        <span>—</span>
                                    )}
                                </div>
                                <StatusTag
                                    variant={
                                        j.status === "completed"
                                            ? "ok"
                                            : j.status === "rejected"
                                              ? "crit"
                                              : j.status === "expired"
                                                ? "muted"
                                                : "neutral"
                                    }
                                >
                                    {j.status}
                                </StatusTag>
                            </li>
                        ))}
                    </ul>
                )}
            </TerminalPanel>
        </div>
    );
}

function Stat({
    label,
    value,
    accent = false,
}: {
    label: string;
    value: string;
    accent?: boolean;
}) {
    return (
        <div>
            <dt className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
            </dt>
            <dd
                className={`font-mono text-xl font-bold tabular-nums ${
                    accent ? "text-primary" : "text-foreground"
                }`}
            >
                {value}
            </dd>
        </div>
    );
}

function formatDuration(ms: number | null): string {
    if (ms === null) return "—";
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}
