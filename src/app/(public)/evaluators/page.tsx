import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";
import { EmptyState } from "@/components/primitives/empty-state";
import {
    loadEvaluatorMarketplace,
    rawUsdcToUsd,
} from "@/lib/evaluators-catalog";

export const dynamic = "force-dynamic";

/**
 * Plan E.4 — public evaluator marketplace. Counterpart to /services for
 * the evaluator side of the job lifecycle: which evaluators are active,
 * how often do they decide vs expire, what do they cost. ArkAge built-in
 * tiers appear as distinct rows (premium / standard / fast); BYO
 * evaluators appear below as one row per address.
 */
export default async function EvaluatorsPage() {
    const evaluators = await loadEvaluatorMarketplace();

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Evaluators
                </h1>
                <p className="max-w-3xl text-sm text-muted-foreground">
                    Every evaluator that has decided at least one ArkAge job.
                    ArkAge built-in tiers (Premium / Standard / Fast — backed
                    by Claude Opus / Sonnet / Haiku) sit at the top. BYO
                    evaluators (any address you pass to{" "}
                    <code className="font-mono">post_job</code>) appear below,
                    ranked by activity.
                </p>
                <p className="text-xs text-muted-foreground">
                    {evaluators.length} evaluator
                    {evaluators.length === 1 ? "" : "s"} active
                </p>
            </header>

            {evaluators.length === 0 ? (
                <EmptyState
                    title="No evaluators yet"
                    description="When the first job gets funded with an evaluator, this page populates automatically."
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {evaluators.map((e) => (
                        <Link key={e.key} href={`/evaluators/${e.key}`}>
                            <Card className="h-full transition-colors hover:bg-muted/30">
                                <CardHeader className="space-y-2 pb-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <CardTitle className="text-base leading-tight">
                                            {e.displayName}
                                        </CardTitle>
                                        <Badge
                                            variant={
                                                e.kind === "arkage-builtin"
                                                    ? "default"
                                                    : "outline"
                                            }
                                            className="text-[10px]"
                                        >
                                            {e.kind === "arkage-builtin"
                                                ? "ArkAge built-in"
                                                : "BYO"}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2 text-xs">
                                    <dl className="grid grid-cols-2 gap-1.5 text-[11px]">
                                        <dt className="text-muted-foreground">
                                            Jobs decided
                                        </dt>
                                        <dd className="font-mono tabular-nums">
                                            {e.jobsEvaluated}
                                        </dd>
                                        <dt className="text-muted-foreground">
                                            Completion rate
                                        </dt>
                                        <dd className="font-mono tabular-nums">
                                            {e.completed + e.rejected === 0
                                                ? "—"
                                                : `${Math.round(e.completionRate * 100)}%`}
                                        </dd>
                                        <dt className="text-muted-foreground">
                                            Avg time to decide
                                        </dt>
                                        <dd className="font-mono tabular-nums">
                                            {formatDuration(e.averageDecisionMs)}
                                        </dd>
                                        <dt className="text-muted-foreground">
                                            Fees earned
                                        </dt>
                                        <dd className="font-mono tabular-nums">
                                            ${rawUsdcToUsd(e.totalFeesEarnedRaw)}
                                        </dd>
                                        <dt className="text-muted-foreground">
                                            Unique clients
                                        </dt>
                                        <dd className="font-mono tabular-nums">
                                            {e.uniqueClients}
                                        </dd>
                                        <dt className="text-muted-foreground">
                                            Address
                                        </dt>
                                        <dd>
                                            <Address value={e.address} />
                                        </dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

function formatDuration(ms: number | null): string {
    if (ms === null) return "—";
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}
