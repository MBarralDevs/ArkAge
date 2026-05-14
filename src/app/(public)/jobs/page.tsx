import Link from "next/link";
import { db } from "@/lib/db";
import { JobListTable } from "@/components/jobs/job-list-table";

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
            <header className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── ERC-8183 ─ programmable settlement ─ on Arc Testnet ──
                </p>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="space-y-1">
                        <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                            Jobs
                        </h1>
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            <span className="text-foreground tabular-nums">
                                {total.toLocaleString()}
                            </span>{" "}
                            total ·{" "}
                            <span className="text-primary tabular-nums">
                                page {page} of {pageCount}
                            </span>
                        </p>
                    </div>
                    <div className="flex flex-wrap items-stretch border border-border">
                        {STATUSES.map((s) => {
                            const active = s === status;
                            return (
                                <Link
                                    key={s}
                                    href={`/jobs?status=${s}`}
                                    className={`border-r border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors last:border-r-0 ${
                                        active
                                            ? "bg-primary text-primary-foreground font-semibold"
                                            : "text-muted-foreground hover:text-primary"
                                    }`}
                                >
                                    {s}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </header>

            <JobListTable rows={tableRows} />

            <nav className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.22em]">
                {page > 1 && (
                    <Link
                        href={`/jobs?status=${status}&page=${page - 1}`}
                        className="border border-border px-3 py-1.5 text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                        ← prev
                    </Link>
                )}
                {page < pageCount && (
                    <Link
                        href={`/jobs?status=${status}&page=${page + 1}`}
                        className="border border-border px-3 py-1.5 text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                        next →
                    </Link>
                )}
            </nav>
        </div>
    );
}
