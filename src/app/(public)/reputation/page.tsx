import { Leaderboard } from "@/components/reputation/leaderboard";
import { ScoreDistribution } from "@/components/reputation/score-distribution";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function buckets(scores: number[]) {
    const labels = ["-100…-51", "-50…-1", "0", "1…25", "26…50", "51…75", "76…100"];
    const counts = labels.map(() => 0);
    for (const s of scores) {
        if (s <= -51) counts[0]!++;
        else if (s <= -1) counts[1]!++;
        else if (s === 0) counts[2]!++;
        else if (s <= 25) counts[3]!++;
        else if (s <= 50) counts[4]!++;
        else if (s <= 75) counts[5]!++;
        else counts[6]!++;
    }
    return labels.map((bucket, i) => ({ bucket, count: counts[i]! }));
}

export default async function ReputationPage() {
    const allFb = await db.reputationFeedback.findMany({ select: { score: true } });
    const top = await db.$queryRaw<Array<{ agent_id: string; avg: number; n: number }>>`
        SELECT a.agent_id::text AS agent_id, AVG(rf.score)::float AS avg, COUNT(*)::int AS n
        FROM reputation_feedback rf JOIN agents a ON a.id = rf.agent_id
        GROUP BY a.id HAVING COUNT(*) >= 3
        ORDER BY AVG(rf.score) DESC LIMIT 25
    `;

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">Reputation</h1>
                <p className="text-sm text-muted-foreground">
                    {allFb.length.toLocaleString()} feedback entries across the protocol
                </p>
            </header>
            <ScoreDistribution data={buckets(allFb.map((f) => f.score ?? 0))} />
            <Leaderboard rows={top.map((r) => ({ agentId: r.agent_id, avg: r.avg, n: r.n }))} />
        </div>
    );
}
