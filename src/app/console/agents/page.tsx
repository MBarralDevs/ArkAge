import { db } from "@/lib/db";
import { requireBuilder } from "@/lib/auth-guard";
import { AgentCard } from "@/components/console/agent-card";
import { EmptyState } from "@/components/primitives/empty-state";

export const dynamic = "force-dynamic";

export default async function ConsoleAgentsPage() {
    const builder = await requireBuilder();

    const wallets = await db.wallet.findMany({
        where: { builderId: builder.builderId, tier: 2 },
    });
    const walletIds = wallets.map((w) => w.id);

    const agents = await db.agent.findMany({
        where: { currentOperatorWalletId: { in: walletIds } },
        include: {
            currentOperatorWallet: true,
            metadata: { orderBy: { createdAt: "desc" }, take: 1 },
            _count: { select: { reputationFeedback: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    if (agents.length === 0) {
        return (
            <EmptyState
                title="No agents yet"
                description="Use the MCP arkage:bootstrap_user tool to provision your first agent."
            />
        );
    }

    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => {
                const m = a.metadata[0]?.metadataJsonb as
                    | { name?: string; description?: string }
                    | undefined;
                return (
                    <AgentCard
                        key={a.agentId.toString()}
                        agentId={a.agentId.toString()}
                        operator={
                            "0x" +
                            Buffer.from(
                                a.currentOperatorWallet.address,
                            ).toString("hex")
                        }
                        active={a.active}
                        metadata={m ?? null}
                        feedbackCount={a._count.reputationFeedback}
                    />
                );
            })}
        </div>
    );
}
