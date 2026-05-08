import Link from "next/link";
import { db } from "@/lib/db";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

async function topAgents() {
    const rows = await db.$queryRaw<
        Array<{ agent_id: string; avg_score: number; n: number }>
    >`
    SELECT a.agent_id::text AS agent_id,
           AVG(rf.score)::float AS avg_score,
           COUNT(*)::int AS n
    FROM reputation_feedback rf
    JOIN agents a ON a.id = rf.agent_id
    GROUP BY a.id, a.agent_id
    HAVING COUNT(*) >= 3
    ORDER BY AVG(rf.score) DESC
    LIMIT 5
  `;
    return rows;
}

export async function Leaderboards() {
    const top = await topAgents();
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Top reputed agents</CardTitle>
            </CardHeader>
            <CardContent>
                {top.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        Not enough reputation events yet.
                    </p>
                ) : (
                    <ol className="space-y-2 text-sm">
                        {top.map((r, i) => (
                            <li
                                key={r.agent_id}
                                className="flex items-center justify-between border-b border-border/30 pb-1.5 last:border-b-0"
                            >
                                <span className="flex items-center gap-3">
                                    <span className="w-5 font-mono text-xs text-muted-foreground">
                                        {i + 1}
                                    </span>
                                    <Link
                                        href={`/agents/${r.agent_id}`}
                                        className="font-medium hover:underline"
                                    >
                                        #{r.agent_id}
                                    </Link>
                                </span>
                                <span className="font-mono tabular-nums text-xs">
                                    {r.avg_score.toFixed(1)}{" "}
                                    <span className="text-muted-foreground">
                                        ({r.n})
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
            </CardContent>
        </Card>
    );
}
