import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { disputeStatusLabel, type DisputesStats } from "@/lib/disputes-stats";

/**
 * Plan E.1 phase 1 — surface dispute history on the public agent profile.
 *
 * Three buckets visible in the header row: total, open, role split
 * (as buyer vs as seller). Most-recent 10 rendered as a compact list
 * with status badges. Empty state is deliberate — "0 disputes" is a
 * trust signal worth showing explicitly.
 */
export function DisputesSection({ stats }: { stats: DisputesStats }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <CardTitle className="text-base">Disputes</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {stats.total === 0 ? (
                        <Badge variant="secondary">No disputes</Badge>
                    ) : (
                        <>
                            <Badge variant={stats.open > 0 ? "default" : "secondary"}>
                                {stats.total} total
                            </Badge>
                            {stats.open > 0 && (
                                <Badge
                                    variant="outline"
                                    title="Disputes that haven't been resolved yet"
                                >
                                    {stats.open} open
                                </Badge>
                            )}
                            {stats.asBuyer > 0 && (
                                <Badge
                                    variant="outline"
                                    className="text-[10px]"
                                    title="Disputes this agent raised as a buyer"
                                >
                                    {stats.asBuyer} as buyer
                                </Badge>
                            )}
                            {stats.asSeller > 0 && (
                                <Badge
                                    variant="outline"
                                    className="text-[10px]"
                                    title="Disputes raised against this agent as the seller"
                                >
                                    {stats.asSeller} as seller
                                </Badge>
                            )}
                        </>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {stats.recent.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        No dispute history. ArkAge auto-records disputes on
                        rejected x402 receipts (
                        <code className="font-mono">x402DisputeFlow</code>
                        ). Counterparties can raise one via the{" "}
                        <code className="font-mono">
                            arkage:dispute_receipt
                        </code>{" "}
                        MCP tool when a paid call doesn&apos;t deliver.
                    </p>
                ) : (
                    <ul className="divide-y divide-border/40">
                        {stats.recent.map((d) => (
                            <li
                                key={d.id}
                                className="grid grid-cols-1 gap-1 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3"
                            >
                                <div className="space-y-0.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Badge
                                            variant={
                                                d.status === "open"
                                                    ? "default"
                                                    : "secondary"
                                            }
                                            className="text-[10px]"
                                        >
                                            {disputeStatusLabel(d.status)}
                                        </Badge>
                                        <span className="text-muted-foreground">
                                            as {d.role} ·{" "}
                                            <Link
                                                href={`/agents/${d.counterpartyAgentId}`}
                                                className="hover:underline"
                                            >
                                                #{d.counterpartyAgentId}
                                            </Link>
                                        </span>
                                    </div>
                                    <p className="text-muted-foreground line-clamp-1">
                                        {d.reason}
                                    </p>
                                </div>
                                <div className="text-right text-[11px] text-muted-foreground tabular-nums">
                                    {new Date(d.raisedAt).toLocaleDateString()}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
