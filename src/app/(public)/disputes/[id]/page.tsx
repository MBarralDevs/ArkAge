import { notFound } from "next/navigation";
import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";
import { DisputeTimeline } from "@/components/disputes/dispute-timeline";
import { loadDisputeDetail } from "@/lib/dispute-detail";
import {
    disputeStatusLabel,
    type DisputeStatus,
} from "@/lib/disputes-stats";

export const dynamic = "force-dynamic";

/**
 * Plan E.1 phase 2.1 — public timeline view for a single dispute.
 * No auth gate; transparency IS the trust-layer.
 */
export default async function DisputeDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) notFound();

    const detail = await loadDisputeDetail(BigInt(id));
    if (!detail) notFound();

    return (
        <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
            <header className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Dispute #{detail.id}
                    </h1>
                    <Badge
                        variant={badgeVariantForStatus(detail.status)}
                        className="text-xs"
                    >
                        {disputeStatusLabel(detail.status)}
                    </Badge>
                </div>
                <p className="max-w-2xl text-sm text-muted-foreground">
                    Disputes on ArkAge are public. The full lifecycle —
                    who raised, why, what the auto-resolution workflow
                    found, how it was settled — is visible on this page.
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Context</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div>
                            <dt className="text-muted-foreground">Receipt</dt>
                            <dd className="font-mono">#{detail.receipt.id}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Amount</dt>
                            <dd className="font-mono tabular-nums">
                                {rawUsdcDisplay(detail.receipt.amount)} USDC
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Session</dt>
                            <dd>
                                <Link
                                    href={`/x402/sessions/${detail.session.id}`}
                                    className="font-mono hover:underline"
                                >
                                    #{detail.session.id}
                                </Link>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">
                                Endpoint URL
                            </dt>
                            <dd className="break-all font-mono text-[11px]">
                                {detail.receipt.url}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Buyer</dt>
                            <dd>
                                <Link
                                    href={`/agents/${detail.session.buyerAgentId}`}
                                    className="font-mono hover:underline"
                                >
                                    agent #{detail.session.buyerAgentId}
                                </Link>{" "}
                                <span className="text-muted-foreground">
                                    (<Address value={detail.receipt.buyerWallet} />)
                                </span>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Seller</dt>
                            <dd>
                                <Link
                                    href={`/agents/${detail.session.sellerAgentId}`}
                                    className="font-mono hover:underline"
                                >
                                    agent #{detail.session.sellerAgentId}
                                </Link>{" "}
                                <span className="text-muted-foreground">
                                    (<Address value={detail.receipt.sellerWallet} />)
                                </span>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">
                                Original HTTP status
                            </dt>
                            <dd className="font-mono">
                                {detail.receipt.httpStatus ?? "—"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">
                                Facilitator processed
                            </dt>
                            <dd className="font-mono text-[11px]">
                                {new Date(
                                    detail.receipt.facilitatorProcessedAt,
                                ).toLocaleString()}
                            </dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                    <DisputeTimeline detail={detail} />
                </CardContent>
            </Card>
        </div>
    );
}

function badgeVariantForStatus(
    s: DisputeStatus,
): "default" | "outline" | "secondary" {
    switch (s) {
        case "resolved_refund":
            return "default";
        case "resolved_no_refund":
            return "outline";
        case "manual_review":
            return "secondary";
        case "open":
            return "default";
    }
}

function rawUsdcDisplay(raw: string): string {
    const big = BigInt(raw);
    const whole = big / 1_000_000n;
    const fracStr =
        (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") ||
        "0";
    return `${whole}.${fracStr}`;
}
