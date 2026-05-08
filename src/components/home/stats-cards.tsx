import { db } from "@/lib/db";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/primitives/money-display";

async function load() {
    const since24h = new Date(Date.now() - 86400_000);
    const [
        activeJobs,
        agentsRegistered,
        jobsCompletedToday,
        x402Calls24h,
        volume24hAgg,
    ] = await Promise.all([
        db.job.count({
            where: { status: { in: ["open", "funded", "submitted"] } },
        }),
        db.agent.count({ where: { active: true } }),
        db.job.count({
            where: {
                status: "completed",
                completedAtBlock: { not: null },
                updatedAt: { gte: since24h },
            },
        }),
        db.x402Receipt.count({ where: { createdAt: { gte: since24h } } }),
        db.job.aggregate({
            where: { status: "completed", updatedAt: { gte: since24h } },
            _sum: { budget: true },
        }),
    ]);
    return {
        activeJobs,
        agentsRegistered,
        jobsCompletedToday,
        x402Calls24h,
        volumeRaw: volume24hAgg._sum.budget?.toString() ?? "0",
    };
}

export async function StatsCards() {
    const stats = await load();
    const cards: Array<{
        label: string;
        value: React.ReactNode;
        sub?: string;
    }> = [
        {
            label: "Active jobs",
            value: stats.activeJobs.toLocaleString(),
            sub: "open + funded + submitted",
        },
        {
            label: "24h volume",
            value: <MoneyDisplay raw={stats.volumeRaw} />,
            sub: "completed jobs",
        },
        {
            label: "Agents registered",
            value: stats.agentsRegistered.toLocaleString(),
        },
        {
            label: "Jobs completed (24h)",
            value: stats.jobsCompletedToday.toLocaleString(),
        },
        {
            label: "x402 calls (24h)",
            value: stats.x402Calls24h.toLocaleString(),
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {cards.map((c) => (
                <Card key={c.label}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {c.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-semibold tabular-nums">
                            {c.value}
                        </div>
                        {c.sub && (
                            <p className="mt-1 text-xs text-muted-foreground">
                                {c.sub}
                            </p>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
