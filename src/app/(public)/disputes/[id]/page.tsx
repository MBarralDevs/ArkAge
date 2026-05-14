import { notFound } from "next/navigation";
import Link from "next/link";
import { Address } from "@/components/primitives/address";
import { DisputeTimeline } from "@/components/disputes/dispute-timeline";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";
import { StatusTag } from "@/components/terminal/status-tag";
import { DataRow } from "@/components/terminal/data-row";
import { loadDisputeDetail } from "@/lib/dispute-detail";
import {
    disputeStatusLabel,
    type DisputeStatus,
} from "@/lib/disputes-stats";

export const dynamic = "force-dynamic";

/**
 * Public timeline view for a single dispute. No auth gate; transparency
 * IS the trust layer.
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
            <header className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── Dispute timeline ─ /disputes/{detail.id} ──
                </p>
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                        Dispute{" "}
                        <span className="text-primary">#{detail.id}</span>
                    </h1>
                    <StatusTag variant={statusTagVariant(detail.status)}>
                        {disputeStatusLabel(detail.status)}
                    </StatusTag>
                </div>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    Disputes on ArkAge are public. The full lifecycle — who
                    raised, why, what the auto-resolution workflow found, how
                    it was settled — is visible on this page.
                </p>
            </header>

            <TerminalPanel label="CONTEXT">
                <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    <DataRow
                        label="Receipt"
                        value={`#${detail.receipt.id}`}
                    />
                    <DataRow
                        label="Amount"
                        value={`${rawUsdcDisplay(detail.receipt.amount)} USDC`}
                        accent
                    />
                    <DataRow
                        label="Session"
                        value={
                            <Link
                                href={`/x402/sessions/${detail.session.id}`}
                                className="text-primary hover:underline"
                            >
                                #{detail.session.id}
                            </Link>
                        }
                    />
                    <DataRow
                        label="Original HTTP"
                        value={detail.receipt.httpStatus ?? "—"}
                    />
                    <DataRow
                        label="Buyer"
                        value={
                            <span className="flex items-center gap-2">
                                <Link
                                    href={`/agents/${detail.session.buyerAgentId}`}
                                    className="text-primary hover:underline"
                                >
                                    #{detail.session.buyerAgentId}
                                </Link>
                                <Address
                                    value={detail.receipt.buyerWallet}
                                />
                            </span>
                        }
                    />
                    <DataRow
                        label="Seller"
                        value={
                            <span className="flex items-center gap-2">
                                <Link
                                    href={`/agents/${detail.session.sellerAgentId}`}
                                    className="text-primary hover:underline"
                                >
                                    #{detail.session.sellerAgentId}
                                </Link>
                                <Address
                                    value={detail.receipt.sellerWallet}
                                />
                            </span>
                        }
                    />
                    <DataRow
                        label="Endpoint URL"
                        value={
                            <span className="break-all text-[11px]">
                                {detail.receipt.url}
                            </span>
                        }
                    />
                    <DataRow
                        label="Facilitator processed"
                        value={
                            <span className="text-[11px]">
                                {new Date(
                                    detail.receipt.facilitatorProcessedAt,
                                ).toLocaleString()}
                            </span>
                        }
                    />
                </dl>
            </TerminalPanel>

            <AsciiDivider label="TIMELINE" />

            <TerminalPanel label="EVENT LOG">
                <DisputeTimeline detail={detail} />
            </TerminalPanel>
        </div>
    );
}

function statusTagVariant(
    s: DisputeStatus,
): "ok" | "warn" | "crit" | "muted" | "neutral" {
    switch (s) {
        case "resolved_refund":
            return "ok";
        case "resolved_no_refund":
            return "muted";
        case "manual_review":
            return "warn";
        case "open":
            return "warn";
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
