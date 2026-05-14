import Link from "next/link";
import { Address } from "@/components/primitives/address";
import { OnchainAnchorBadge } from "@/components/primitives/onchain-anchor-badge";
import { StatusTag } from "@/components/terminal/status-tag";

interface Row {
    agentId: string;
    operator: string;
    active: boolean;
    feedbackCount: number;
    averageScore: number | null;
    chainAgentId: bigint | null;
    identityRegisterTxHash: Uint8Array | null;
}

/**
 * Terminal-style agent listing. Drops shadcn `Table` for a hand-rolled
 * monospace grid so:
 *   - hairline borders match the rest of the UI vocabulary
 *   - hover row gets an amber left-bar indicator (`▎`)
 *   - status reads as text tags instead of pill badges
 */
export function AgentsTable({ rows }: { rows: Row[] }) {
    if (rows.length === 0) {
        return (
            <p className="border border-dashed border-border/60 px-4 py-12 text-center text-xs uppercase tracking-[0.22em] text-muted-foreground">
                No agents yet
            </p>
        );
    }
    return (
        <div className="overflow-x-auto border border-border">
            <table className="w-full font-mono text-xs">
                <thead className="border-b border-border bg-background/60">
                    <tr className="text-left text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        <th className="px-3 py-2 font-normal">Agent</th>
                        <th className="px-3 py-2 font-normal">Operator</th>
                        <th className="px-3 py-2 font-normal">Anchor</th>
                        <th className="px-3 py-2 font-normal">Status</th>
                        <th className="px-3 py-2 text-right font-normal">
                            Feedback
                        </th>
                        <th className="px-3 py-2 text-right font-normal">
                            Avg
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr
                            key={r.agentId}
                            className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-primary/5"
                        >
                            <td className="px-3 py-2.5">
                                <Link
                                    href={`/agents/${r.agentId}`}
                                    className="flex items-center gap-2 text-foreground transition-colors group-hover:text-primary"
                                >
                                    <span
                                        aria-hidden
                                        className="text-primary opacity-0 transition-opacity group-hover:opacity-100"
                                    >
                                        ▎
                                    </span>
                                    <span className="font-mono tabular-nums">
                                        #{r.agentId}
                                    </span>
                                </Link>
                            </td>
                            <td className="px-3 py-2.5">
                                <Address value={r.operator} />
                            </td>
                            <td className="px-3 py-2.5">
                                <OnchainAnchorBadge
                                    chainAgentId={r.chainAgentId}
                                    identityTxHash={r.identityRegisterTxHash}
                                />
                            </td>
                            <td className="px-3 py-2.5">
                                <StatusTag
                                    variant={r.active ? "ok" : "muted"}
                                    mark={r.active ? "·" : "~"}
                                >
                                    {r.active ? "active" : "inactive"}
                                </StatusTag>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                                {r.feedbackCount === 0 ? (
                                    <span className="text-muted-foreground/70">
                                        —
                                    </span>
                                ) : (
                                    r.feedbackCount
                                )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-primary">
                                {r.averageScore?.toFixed(1) ?? (
                                    <span className="text-muted-foreground/70">
                                        —
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
