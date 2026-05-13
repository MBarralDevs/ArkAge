"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Row {
    tier: string;
    count: number;
    averageScore: number | null;
}

/**
 * Plan E.2 — per-evaluator-tier reputation rollup. Renders one row per
 * tier present in the agent's feedback, with average score + share-of-total
 * bar. Helps a viewer distinguish "rep among premium evaluators" from
 * "rep among fast evaluators" — both signal something different about the
 * agent's reliability.
 *
 * `unknown` tier covers feedback whose `jobId` was null at write time
 * (external sources / pre-ArkAge feedback); rendered last with a muted
 * style.
 */
export function ReputationByEvaluator({ rows }: { rows: Row[] }) {
    if (rows.length === 0) {
        return null;
    }
    const totalCount = rows.reduce((a, r) => a + r.count, 0);
    const sorted = [...rows].sort(sortByTierPriority);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">By evaluator tier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {sorted.map((r) => {
                    const share =
                        totalCount === 0 ? 0 : (r.count / totalCount) * 100;
                    return (
                        <div key={r.tier} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant={
                                            r.tier === "unknown"
                                                ? "outline"
                                                : "secondary"
                                        }
                                        className="capitalize text-[10px]"
                                    >
                                        {r.tier}
                                    </Badge>
                                    <span className="text-muted-foreground">
                                        {r.count} event
                                        {r.count === 1 ? "" : "s"}
                                    </span>
                                </div>
                                <span className="font-mono tabular-nums">
                                    {r.averageScore != null
                                        ? r.averageScore.toFixed(2)
                                        : "—"}
                                </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                                <div
                                    className="h-full bg-foreground/70"
                                    style={{ width: `${share}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}

const TIER_PRIORITY = ["premium", "standard", "fast"] as const;

function sortByTierPriority(a: Row, b: Row): number {
    const ai = TIER_PRIORITY.indexOf(
        a.tier as (typeof TIER_PRIORITY)[number],
    );
    const bi = TIER_PRIORITY.indexOf(
        b.tier as (typeof TIER_PRIORITY)[number],
    );
    if (ai === -1 && bi === -1) return a.tier.localeCompare(b.tier);
    if (ai === -1) return 1; // unknown / other tiers last
    if (bi === -1) return -1;
    return ai - bi;
}
