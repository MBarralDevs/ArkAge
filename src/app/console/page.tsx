import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilder } from "@/lib/auth-guard";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { JobStatusBadge } from "@/components/primitives/job-status-badge";
import { MoneyDisplay } from "@/components/primitives/money-display";

export const dynamic = "force-dynamic";

export default async function ConsoleHome() {
    const builder = await requireBuilder();

    const wallets = await db.wallet.findMany({
        where: { builderId: builder.builderId, tier: 2 },
        select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);
    const agents = await db.agent.findMany({
        where: { currentOperatorWalletId: { in: walletIds } },
        select: { id: true, agentId: true, active: true },
    });
    const agentIds = agents.map((a) => a.id);

    const recentJobs = await db.job.findMany({
        where: {
            OR: [
                { clientAgentId: { in: agentIds } },
                { providerAgentId: { in: agentIds } },
            ],
        },
        orderBy: { createdAt: "desc" },
        take: 10,
    });

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            Agents
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold">
                            {agents.length}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            Active
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold">
                            {agents.filter((a) => a.active).length}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            Recent jobs
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold">
                            {recentJobs.length}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            Quick
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link
                            href="/console/agents"
                            className="text-sm underline-offset-4 hover:underline"
                        >
                            Manage agents →
                        </Link>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Recent jobs (across your agents)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {recentJobs.length === 0 ? (
                        <p className="py-6 text-sm text-muted-foreground">
                            No jobs yet. Use the MCP{" "}
                            <code>arkage:post_job</code> tool from your agent.
                        </p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {recentJobs.map((j) => (
                                <li
                                    key={j.jobId.toString()}
                                    className="flex items-center justify-between border-b border-border/30 pb-2 last:border-b-0"
                                >
                                    <Link
                                        href={`/jobs/${j.jobId.toString()}`}
                                        className="font-mono hover:underline"
                                    >
                                        #{j.jobId.toString()}
                                    </Link>
                                    <span className="flex items-center gap-3">
                                        <JobStatusBadge status={j.status} />
                                        <MoneyDisplay
                                            raw={
                                                j.budget?.toString() ?? null
                                            }
                                        />
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
