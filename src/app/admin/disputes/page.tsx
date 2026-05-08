import { db } from "@/lib/db";
import { DisputesTable } from "@/components/admin/disputes-table";

export const dynamic = "force-dynamic";

export default async function DisputesPage() {
    const rows = await db.x402Dispute.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">x402 disputes</h2>
            <DisputesTable
                rows={rows.map((r) => ({
                    id: r.id.toString(),
                    receiptId: r.receiptId.toString(),
                    status: r.status,
                    reason: r.reason,
                    createdAt: r.createdAt.toISOString(),
                    resolvedAt: r.resolvedAt?.toISOString() ?? null,
                }))}
            />
        </div>
    );
}
