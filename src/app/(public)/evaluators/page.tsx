import Link from "next/link";
import { Address } from "@/components/primitives/address";
import { EmptyState } from "@/components/primitives/empty-state";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";
import { StatusTag } from "@/components/terminal/status-tag";
import {
    loadEvaluatorMarketplace,
    rawUsdcToUsd,
} from "@/lib/evaluators-catalog";

export const dynamic = "force-dynamic";

/**
 * Public evaluator marketplace. Counterpart to /services for the
 * evaluator side of the job lifecycle.
 */
export default async function EvaluatorsPage() {
    const evaluators = await loadEvaluatorMarketplace();
    const arkageCount = evaluators.filter((e) => e.kind === "arkage-builtin")
        .length;
    const byoCount = evaluators.length - arkageCount;
    const totalJobs = evaluators.reduce((a, e) => a + e.jobsEvaluated, 0);

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <TerminalPanel label="ARKAGE / EVALUATOR MARKETPLACE">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                            ── Who decides ─ for whom ─ at what price ──
                        </p>
                        <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                            Evaluators
                        </h1>
                        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                            Every evaluator that has decided at least one
                            ArkAge job. Built-in tiers (Premium / Standard /
                            Fast — backed by Claude Opus / Sonnet / Haiku) sit
                            at the top. Bring-your-own evaluators (any address
                            you pass to post_job) appear below, ranked by
                            activity.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-border/60 pt-4">
                        <Stat
                            label="Built-in"
                            value={arkageCount.toString()}
                            accent
                        />
                        <Stat label="BYO" value={byoCount.toString()} />
                        <Stat
                            label="Jobs decided"
                            value={totalJobs.toString()}
                        />
                    </div>
                </div>
            </TerminalPanel>

            <AsciiDivider label="CATALOG" />

            {evaluators.length === 0 ? (
                <EmptyState
                    title="No evaluators yet"
                    description="When the first job gets funded with an evaluator, this page populates automatically."
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {evaluators.map((e) => (
                        <Link
                            key={e.key}
                            href={`/evaluators/${e.key}`}
                            className="block h-full"
                        >
                            <article className="group relative flex h-full flex-col border border-border bg-card/30 transition-colors hover:border-primary">
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute -top-[5px] -left-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                                >
                                    +
                                </span>
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute -bottom-[5px] -right-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                                >
                                    +
                                </span>
                                <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/60 px-4 py-2 text-[10px] uppercase tracking-[0.18em]">
                                    <span className="text-muted-foreground">
                                        {e.kind === "arkage-builtin"
                                            ? "BUILT-IN"
                                            : "BYO"}
                                    </span>
                                    <StatusTag
                                        variant={
                                            e.kind === "arkage-builtin"
                                                ? "ok"
                                                : "neutral"
                                        }
                                        mark={
                                            e.kind === "arkage-builtin"
                                                ? "·"
                                                : "~"
                                        }
                                    >
                                        {e.kind === "arkage-builtin"
                                            ? "ArkAge"
                                            : "External"}
                                    </StatusTag>
                                </header>
                                <div className="px-4 py-3">
                                    <h3 className="font-mono text-sm font-bold leading-tight text-foreground group-hover:text-primary">
                                        {e.displayName}
                                    </h3>
                                </div>
                                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/60 px-4 py-3 text-[11px]">
                                    <Row
                                        label="Jobs decided"
                                        value={e.jobsEvaluated.toString()}
                                        accent
                                    />
                                    <Row
                                        label="Completion"
                                        value={
                                            e.completed + e.rejected === 0
                                                ? "—"
                                                : `${Math.round(e.completionRate * 100)}%`
                                        }
                                    />
                                    <Row
                                        label="Avg decide"
                                        value={formatDuration(
                                            e.averageDecisionMs,
                                        )}
                                    />
                                    <Row
                                        label="Fees"
                                        value={`$${rawUsdcToUsd(e.totalFeesEarnedRaw)}`}
                                    />
                                    <Row
                                        label="Clients"
                                        value={e.uniqueClients.toString()}
                                    />
                                </dl>
                                <div className="border-t border-border/60 px-4 py-2 text-[10px] uppercase tracking-[0.18em]">
                                    <Address value={e.address} />
                                </div>
                            </article>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

function Row({
    label,
    value,
    accent = false,
}: {
    label: string;
    value: string;
    accent?: boolean;
}) {
    return (
        <>
            <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
            </dt>
            <dd
                className={`text-right font-mono tabular-nums ${
                    accent ? "text-primary" : "text-foreground"
                }`}
            >
                {value}
            </dd>
        </>
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
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
            </p>
            <p
                className={`font-mono text-2xl font-bold tabular-nums ${
                    accent ? "text-primary" : "text-foreground"
                }`}
            >
                {value}
            </p>
        </div>
    );
}

function formatDuration(ms: number | null): string {
    if (ms === null) return "—";
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}
