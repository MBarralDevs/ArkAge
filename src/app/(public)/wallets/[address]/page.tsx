import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Address } from "@/components/primitives/address";
import { TierAwareTxHistory } from "@/components/wallets/tier-aware-tx-history";

export const dynamic = "force-dynamic";

export default async function WalletPage({
    params,
}: {
    params: Promise<{ address: string }>;
}) {
    const { address } = await params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) notFound();

    const buf = Buffer.from(address.slice(2), "hex");
    const wallet = await db.wallet.findUnique({ where: { address: buf } });

    const recentEvents = await db.jobEvent.findMany({
        where: { actorAddress: buf },
        orderBy: { blockTime: "desc" },
        take: 50,
        include: { job: { select: { jobId: true } } },
    });

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
                <Address value={address} full />
                {wallet && (
                    <p className="text-xs text-muted-foreground">
                        Tier {wallet.tier} · {wallet.custody} ·{" "}
                        {wallet.accountType.toUpperCase()} · {wallet.status}
                    </p>
                )}
            </header>

            <TierAwareTxHistory
                tierLabel={wallet ? wallet.tier.toString() : "—"}
                entries={recentEvents.map((e) => ({
                    txHash: "0x" + Buffer.from(e.txHash).toString("hex"),
                    eventKind: e.eventKind,
                    jobId: e.job.jobId.toString(),
                    blockTime: e.blockTime.toISOString(),
                }))}
            />
        </div>
    );
}
