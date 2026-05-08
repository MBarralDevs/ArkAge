import { notFound } from "next/navigation";
import { requireBuilder } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Address } from "@/components/primitives/address";
import { Badge } from "@/components/ui/badge";
import { PolicyEditor } from "@/components/console/policy-editor";
import { RevokeDialog } from "@/components/console/revoke-dialog";

export const dynamic = "force-dynamic";

export default async function ConsoleAgentDetail({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const builder = await requireBuilder();
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) notFound();

    const agent = await db.agent.findUnique({
        where: { agentId: id },
        include: {
            currentOperatorWallet: true,
            metadata: { orderBy: { createdAt: "desc" }, take: 1 },
            policies: { orderBy: { version: "desc" }, take: 1 },
        },
    });
    if (!agent) notFound();

    // Ownership gate: the operator wallet must belong to the signed-in builder.
    if (agent.currentOperatorWallet.builderId !== builder.builderId) {
        notFound();
    }

    const policy = agent.policies[0];
    const policyJson = JSON.stringify(policy?.bodyJsonb, null, 2);
    const body = (policy?.bodyJsonb ?? {}) as Record<string, unknown>;
    const spendCaps =
        (body.spendCaps as Record<string, string> | undefined) ?? {};
    const cp =
        (body.counterpartyRules as Record<string, unknown> | undefined) ?? {};
    const rl = (body.rateLimits as Record<string, number> | undefined) ?? {};

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                    <div>
                        <CardTitle className="text-lg">
                            Agent #{agent.agentId.toString()}
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Operator{" "}
                            <Address
                                value={
                                    "0x" +
                                    Buffer.from(
                                        agent.currentOperatorWallet.address,
                                    ).toString("hex")
                                }
                            />
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant={agent.active ? "default" : "outline"}>
                            {agent.active ? "active" : "inactive"}
                        </Badge>
                        <RevokeDialog agentId={agent.agentId.toString()} />
                    </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                    Policy v{policy?.version ?? "—"} · last updated{" "}
                    {policy?.createdAt.toLocaleString() ?? "n/a"}
                </CardContent>
            </Card>

            <PolicyEditor
                agentId={agent.agentId.toString()}
                current={{
                    perTx: spendCaps.perTx ?? "0",
                    perDay: spendCaps.perDay ?? "0",
                    perWeek: spendCaps.perWeek ?? "0",
                    allowedContracts:
                        (body.allowedContracts as string[] | undefined) ?? [],
                    denyList:
                        (cp as { denyList?: string[] }).denyList ?? [],
                    minReputation:
                        (cp as { minReputation?: number | null })
                            .minReputation ?? null,
                    jobsPerHour: rl.jobsPerHour ?? 0,
                    x402CallsPerMinute: rl.x402CallsPerMinute ?? 0,
                }}
                rawJson={policyJson}
            />
        </div>
    );
}
