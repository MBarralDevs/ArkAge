import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { disputeStatusLabel } from "@/lib/disputes-stats";
import type { DisputeDetail } from "@/lib/dispute-detail";

/**
 * Plan E.1 phase 2.1 — chronological event list for `/disputes/[id]`.
 *
 * Renders the dispute lifecycle as a stack of dated events: raised →
 * workflow started → (counter-party responded, when phase 2.2 ships) →
 * workflow completed → resolution.
 *
 * Public-facing: no auth gate. Showing the timeline is part of the trust-
 * layer pitch — anyone watching ArkAge can see exactly how disputes were
 * handled, by whom, with what evidence.
 */
export function DisputeTimeline({ detail }: { detail: DisputeDetail }) {
    const events = buildEvents(detail);
    return (
        <ol className="space-y-3">
            {events.map((e, i) => (
                <li
                    key={i}
                    className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-border/40 bg-background/40 p-3"
                >
                    <div className="flex flex-col items-center pt-0.5">
                        <div className={`size-2 rounded-full ${dotColor(e.kind)}`} />
                        {i < events.length - 1 && (
                            <div className="mt-1 w-px flex-1 bg-border/40" />
                        )}
                    </div>
                    <div className="space-y-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-sm font-medium">{e.title}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                                {new Date(e.ts).toLocaleString()}
                            </span>
                            {e.badge && (
                                <Badge
                                    variant={e.badgeVariant ?? "secondary"}
                                    className="text-[10px]"
                                >
                                    {e.badge}
                                </Badge>
                            )}
                        </div>
                        {e.body && (
                            <div className="text-xs text-muted-foreground">
                                {e.body}
                            </div>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
}

interface TimelineEvent {
    kind: "raise" | "workflow" | "response" | "resolve";
    title: string;
    ts: string;
    body?: React.ReactNode;
    badge?: string;
    badgeVariant?: "default" | "secondary" | "outline";
}

function buildEvents(d: DisputeDetail): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    events.push({
        kind: "raise",
        title: "Dispute raised",
        ts: d.raisedAt,
        body: (
            <div className="space-y-1">
                <div>
                    By{" "}
                    <Link
                        href={`/agents/${d.session.buyerAgentId}`}
                        className="font-mono hover:underline"
                    >
                        agent #{d.session.buyerAgentId}
                    </Link>{" "}
                    against{" "}
                    <Link
                        href={`/agents/${d.session.sellerAgentId}`}
                        className="font-mono hover:underline"
                    >
                        #{d.session.sellerAgentId}
                    </Link>
                </div>
                <div>Reason: {d.reason}</div>
                {d.evidence !== null && (
                    <details className="text-[11px]">
                        <summary className="cursor-pointer hover:text-foreground">
                            Evidence
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono">
                            {JSON.stringify(d.evidence, null, 2)}
                        </pre>
                    </details>
                )}
            </div>
        ),
    });

    if (d.workflow) {
        events.push({
            kind: "workflow",
            title: "Auto-resolution workflow started",
            ts: d.workflow.startedAt,
            body: `Run id ${d.workflow.runId}`,
            badge: d.workflow.status,
        });
    }

    if (d.counterpartyRespondedAt) {
        events.push({
            kind: "response",
            title: "Counter-party responded",
            ts: d.counterpartyRespondedAt,
            body: d.counterpartyResponse ? (
                <details className="text-[11px]">
                    <summary className="cursor-pointer hover:text-foreground">
                        Response
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono">
                        {JSON.stringify(d.counterpartyResponse, null, 2)}
                    </pre>
                </details>
            ) : undefined,
        });
    }

    if (d.workflow?.completedAt) {
        events.push({
            kind: "workflow",
            title: "Workflow completed",
            ts: d.workflow.completedAt,
            body: d.workflow.error
                ? `Error: ${d.workflow.error}`
                : undefined,
            badge: d.workflow.error ? "error" : "complete",
            badgeVariant: d.workflow.error ? "outline" : "default",
        });
    }

    if (d.resolvedAt) {
        events.push({
            kind: "resolve",
            title: `Resolved — ${disputeStatusLabel(d.status)}`,
            ts: d.resolvedAt,
            badge: d.status,
            badgeVariant:
                d.status === "resolved_refund"
                    ? "default"
                    : d.status === "resolved_no_refund"
                      ? "outline"
                      : "secondary",
        });
    }

    return events;
}

function dotColor(kind: TimelineEvent["kind"]): string {
    switch (kind) {
        case "raise":
            return "bg-yellow-500";
        case "workflow":
            return "bg-blue-500";
        case "response":
            return "bg-purple-500";
        case "resolve":
            return "bg-green-500";
    }
}
