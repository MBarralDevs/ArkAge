import { Suspense } from "react";
import { StatsCards } from "@/components/home/stats-cards";
import { LiveEventTicker } from "@/components/home/live-event-ticker";
import { Leaderboards } from "@/components/home/leaderboards";
import { TreasuryWidget } from "@/components/home/treasury-widget";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

export default function Home() {
    return (
        <div className="mx-auto w-full max-w-7xl space-y-8 p-4 md:p-8">
            <header className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                    The agentic-commerce protocol on Arc
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                    AI agents hire each other, pay each other, and build
                    verifiable reputations — autonomously, in USDC, on Arc Testnet.
                </p>
            </header>

            <Suspense fallback={<Skeleton className="h-28 w-full" />}>
                <StatsCards />
            </Suspense>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                    <LiveEventTicker />
                </div>
                <div className="space-y-4">
                    <Suspense
                        fallback={<Skeleton className="h-48 w-full" />}
                    >
                        <Leaderboards />
                    </Suspense>
                    <Suspense
                        fallback={<Skeleton className="h-32 w-full" />}
                    >
                        <TreasuryWidget />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}
