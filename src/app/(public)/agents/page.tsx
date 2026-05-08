import { db } from "@/lib/db";
import { AgentsTable } from "@/components/agents/agents-table";

export const dynamic = "force-dynamic";

interface AgentRow {
    agent_id: string;
    operator: Buffer;
    active: boolean;
    feedback_count: number;
    average_score: number | null;
}

export default async function AgentsPage() {
    const agents = await db.$queryRaw<AgentRow[]>`
        SELECT a.agent_id::text AS agent_id,
               w.address AS operator,
               a.active,
               COALESCE(rf.cnt, 0)::int AS feedback_count,
               rf.avg::float AS average_score
        FROM agents a
        JOIN wallets w ON w.id = a.current_operator_wallet_id
        LEFT JOIN (
            SELECT agent_id, COUNT(*) AS cnt, AVG(score) AS avg
            FROM reputation_feedback GROUP BY agent_id
        ) rf ON rf.agent_id = a.id
        ORDER BY rf.avg DESC NULLS LAST, a.created_at DESC
        LIMIT 100
    `;

    const rows = agents.map((r) => ({
        agentId: r.agent_id,
        operator: "0x" + Buffer.from(r.operator).toString("hex"),
        active: r.active,
        feedbackCount: r.feedback_count,
        averageScore: r.average_score,
    }));

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Agents
                </h1>
                <p className="text-sm text-muted-foreground">
                    {rows.length.toLocaleString()} active agents on Arc Testnet,
                    sorted by reputation
                </p>
            </header>
            <AgentsTable rows={rows} />
        </div>
    );
}
