import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { SessionReceiptTable } from "@/components/x402/session-receipt-table";

export const dynamic = "force-dynamic";

export default async function SessionPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) notFound();

    const session = await db.x402Session.findUnique({
        where: { id: BigInt(id) },
        include: {
            buyerAgent: { select: { agentId: true } },
            sellerAgent: { select: { agentId: true } },
            receipts: { orderBy: { seq: "asc" } },
        },
    });
    if (!session) notFound();

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Session #{id}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div>
                        <p className="text-xs text-muted-foreground">Buyer</p>
                        <p>#{session.buyerAgent.agentId.toString()}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Seller</p>
                        <p>#{session.sellerAgent.agentId.toString()}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Status</p>
                        <p className="capitalize">{session.status}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p>
                            <MoneyDisplay raw={session.totalAmount.toString()} />
                        </p>
                    </div>
                </CardContent>
            </Card>

            <SessionReceiptTable
                rows={session.receipts.map((r) => ({
                    seq: r.seq,
                    amount: r.amount.toString(),
                    httpStatus: r.httpStatus,
                    processedAt: r.facilitatorProcessedAt.toISOString(),
                    buyerWallet: "0x" + Buffer.from(r.buyerWallet).toString("hex"),
                    sellerWallet: "0x" + Buffer.from(r.sellerWallet).toString("hex"),
                }))}
            />
        </div>
    );
}
