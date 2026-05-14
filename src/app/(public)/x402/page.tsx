import Link from "next/link";
import { db } from "@/lib/db";
import { TrafficOverview } from "@/components/x402/traffic-overview";

export const dynamic = "force-dynamic";

export default async function X402Page() {
    const since = new Date(Date.now() - 86400_000);
    const [sessions24h, receipts24h, volumeAgg, activeSessions] = await Promise.all([
        db.x402Session.count({ where: { openedAt: { gte: since } } }),
        db.x402Receipt.count({ where: { createdAt: { gte: since } } }),
        db.x402Receipt.aggregate({
            where: { createdAt: { gte: since } },
            _sum: { amount: true },
        }),
        db.x402Session.count({ where: { status: "open" } }),
    ]);

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <header className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── x402 nanopayments ─ Circle Gateway facilitator ──
                </p>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="space-y-1">
                        <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                            x402 traffic
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Sub-cent agent-to-agent payments via Circle
                            Gateway facilitator
                        </p>
                    </div>
                    <Link
                        href="/x402/sellers"
                        className="border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                        [top&nbsp;sellers&nbsp;→]
                    </Link>
                </div>
            </header>
            <TrafficOverview
                stats={{
                    sessions24h,
                    receipts24h,
                    volume24h: volumeAgg._sum.amount?.toString() ?? "0",
                    activeSessions,
                }}
            />
        </div>
    );
}
