import { notFound } from "next/navigation";
import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";
import {
    loadEvaluatorDetail,
    rawUsdcToUsd,
} from "@/lib/evaluators-catalog";

export const dynamic = "force-dynamic";

/**
 * Plan E.4 — per-evaluator detail page. Same shape as /agents/[id] but
 * scoped to the evaluator's job history. URL key format: `arkage:premium`
 * | `arkage:standard` | `arkage:fast` | `byo:0x...`.
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
            <header className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {detail.displayName}
                    </h1>
                    <Badge
                        variant={
                            detail.kind === "arkage-builtin"
                                ? "default"
                                : "outline"
                        }
                    >
                        {detail.kind === "arkage-builtin"
                            ? "ArkAge built-in"
                            : "BYO"}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                    <Address value={detail.address} />
                    {detail.tier && ` · tier ${detail.tier}`}
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Activity</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                        <Stat label="Jobs decided" value={detail.jobsEvaluated.toString()} />
                        <Stat
                            label="Completion rate"
                            value={
                                detail.completed + detail.rejected === 0
                                    ? "—"
                                    : `${Math.round(detail.completionRate * 100)}%`
                            }
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
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Recent jobs</CardTitle>
                </CardHeader>
                <CardContent>
                    {detail.recentJobs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            No jobs decided yet.
                        </p>
                    ) : (
                        <ul className="divide-y divide-border/40 text-xs">
                            {detail.recentJobs.map((j) => (
                                <li
                                    key={j.jobId}
                                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2"
                                >
                                    <Link
                                        href={`/jobs/${j.jobId}`}
                                        className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                    >
                                        #{j.jobId}
                                    </Link>
                                    <div className="text-muted-foreground">
                                        <Link
                                            href={`/agents/${j.clientAgentId}`}
                                            className="font-mono hover:underline"
                                        >
                                            #{j.clientAgentId}
                                        </Link>{" "}
                                        →{" "}
                                        {j.providerAgentId ? (
                                            <Link
                                                href={`/agents/${j.providerAgentId}`}
                                                className="font-mono hover:underline"
                                            >
                                                #{j.providerAgentId}
                                            </Link>
                                        ) : (
                                            <span>—</span>
                                        )}
                                    </div>
                                    <Badge
                                        variant={
                                            j.status === "completed"
                                                ? "default"
                                                : "outline"
                                        }
                                        className="text-[10px]"
                                    >
                                        {j.status}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
        </div>
    );
}

function formatDuration(ms: number | null): string {
    if (ms === null) return "—";
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}
