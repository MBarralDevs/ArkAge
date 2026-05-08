import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilder } from "@/lib/auth-guard";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
    const builder = await requireBuilder();

    const wallets = await db.wallet.findMany({
        where: { builderId: builder.builderId, tier: 2 },
        select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);
    const agents = await db.agent.findMany({
        where: { currentOperatorWalletId: { in: walletIds } },
        select: { id: true, agentId: true },
    });
    const agentIds = agents.map((a) => a.id);
    const policies = await db.policy.findMany({
        where: { agentId: { in: agentIds } },
        orderBy: [{ agentId: "asc" }, { version: "desc" }],
        take: 100,
    });

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">Policy versions</h2>
            <div className="space-y-2">
                {policies.map((p) => {
                    const agentRow = agents.find((a) => a.id === p.agentId);
                    return (
                        <Card key={p.id.toString()}>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm">
                                    {agentRow ? (
                                        <Link
                                            href={`/console/agents/${agentRow.agentId.toString()}`}
                                            className="font-mono hover:underline"
                                        >
                                            #{agentRow.agentId.toString()}
                                        </Link>
                                    ) : (
                                        <span className="font-mono">—</span>
                                    )}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        v{p.version}
                                    </span>
                                </CardTitle>
                                <span className="text-xs text-muted-foreground">
                                    {p.createdAt.toLocaleString()}
                                    {p.validTo
                                        ? ` — invalidated ${p.validTo.toLocaleString()}`
                                        : ""}
                                </span>
                            </CardHeader>
                            <CardContent>
                                <code className="font-mono text-xs">
                                    hash: 0x
                                    {Buffer.from(p.canonicalHash)
                                        .toString("hex")
                                        .slice(0, 16)}
                                    …
                                </code>
                            </CardContent>
                        </Card>
                    );
                })}
                {policies.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        No policy versions yet.
                    </p>
                )}
            </div>
        </div>
    );
}
