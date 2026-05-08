import { db } from "@/lib/db";
import { SellerLeaderboard } from "@/components/x402/seller-leaderboard";

export const dynamic = "force-dynamic";

export default async function SellersPage() {
    const rows = await db.$queryRaw<
        Array<{ agent_id: string; receipts: number; revenue: string }>
    >`
        SELECT a.agent_id::text AS agent_id,
               COUNT(*)::int AS receipts,
               SUM(r.amount)::text AS revenue
        FROM x402_receipts r
        JOIN x402_endpoints e ON e.id = r.endpoint_id
        JOIN agents a ON a.id = e.seller_agent_id
        GROUP BY a.agent_id
        ORDER BY SUM(r.amount) DESC
        LIMIT 25
    `;

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Top x402 sellers
                </h1>
                <p className="text-sm text-muted-foreground">
                    Ranked by lifetime revenue
                </p>
            </header>
            <SellerLeaderboard
                rows={rows.map((r) => ({
                    agentId: r.agent_id,
                    receipts: r.receipts,
                    revenue: r.revenue,
                }))}
            />
        </div>
    );
}
