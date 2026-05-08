import Link from "next/link";
import { db } from "@/lib/db";
import { JobListTable } from "@/components/jobs/job-list-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";

const STATUSES = [
    "all",
    "open",
    "funded",
    "submitted",
    "completed",
    "rejected",
    "expired",
] as const;
type Status = (typeof STATUSES)[number];

export default async function JobsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>;
}) {
    const sp = await searchParams;
    const status = (
        STATUSES.includes(sp.status as Status) ? sp.status : "all"
    ) as Status;
    const page = Math.max(1, Number(sp.page ?? "1") || 1);
    const pageSize = 25;

    const where = status === "all" ? {} : { status };
    const [rows, total] = await Promise.all([
        db.job.findMany({
            where,
            include: {
                clientAgent: { select: { agentId: true } },
                providerAgent: { select: { agentId: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        db.job.count({ where }),
    ]);

    const tableRows = rows.map((r) => ({
        jobId: r.jobId.toString(),
        status: r.status,
        budget: r.budget?.toString() ?? null,
        expiredAt: r.expiredAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        clientAgentId: r.clientAgent?.agentId?.toString() ?? null,
        providerAgentId: r.providerAgent?.agentId?.toString() ?? null,
    }));

    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Jobs
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {total.toLocaleString()} total · page {page} of{" "}
                        {pageCount}
                    </p>
                </div>
                <Tabs value={status}>
                    <TabsList>
                        {STATUSES.map((s) => (
                            <TabsTrigger key={s} value={s} asChild>
                                <Link href={`/jobs?status=${s}`}>{s}</Link>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </header>

            <JobListTable rows={tableRows} />

            <nav className="flex items-center justify-center gap-2 text-sm">
                {page > 1 && (
                    <Link
                        href={`/jobs?status=${status}&page=${page - 1}`}
                        className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted/50"
                    >
                        ← Previous
                    </Link>
                )}
                {page < pageCount && (
                    <Link
                        href={`/jobs?status=${status}&page=${page + 1}`}
                        className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted/50"
                    >
                        Next →
                    </Link>
                )}
            </nav>
        </div>
    );
}
