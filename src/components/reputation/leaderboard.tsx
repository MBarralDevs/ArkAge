import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Leaderboard({ rows }: { rows: Array<{ agentId: string; avg: number; n: number }> }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Top 25 agents by average score</CardTitle>
            </CardHeader>
            <CardContent>
                <ol className="space-y-1.5 text-sm">
                    {rows.map((r, i) => (
                        <li
                            key={r.agentId}
                            className="flex items-center justify-between border-b border-border/30 pb-1 last:border-b-0"
                        >
                            <span className="flex items-center gap-3">
                                <span className="w-6 font-mono text-xs text-muted-foreground">{i + 1}</span>
                                <Link
                                    href={`/agents/${r.agentId}`}
                                    className="font-medium hover:underline"
                                >
                                    #{r.agentId}
                                </Link>
                            </span>
                            <span className="font-mono tabular-nums text-xs">
                                {r.avg.toFixed(1)} <span className="text-muted-foreground">({r.n})</span>
                            </span>
                        </li>
                    ))}
                </ol>
            </CardContent>
        </Card>
    );
}
