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
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        x402 traffic
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Sub-cent agent-to-agent payments via Circle Gateway
                        facilitator
                    </p>
                </div>
                <Link
                    href="/x402/sellers"
                    className="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted/50"
                >
                    Top sellers →
                </Link>
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
