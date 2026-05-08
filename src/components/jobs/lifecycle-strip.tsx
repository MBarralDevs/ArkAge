import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = ["created", "funded", "submitted", "terminal"] as const;
type Stage = (typeof STAGES)[number];

interface Event {
    eventKind: string;
    blockTime: string;
}

export function LifecycleStrip({
    status,
    events,
}: {
    status: string;
    events: Event[];
}) {
    const reachedAt: Partial<Record<Stage, string>> = {};
    for (const e of events) {
        if (e.eventKind === "created") reachedAt.created = e.blockTime;
        if (e.eventKind === "funded") reachedAt.funded = e.blockTime;
        if (e.eventKind === "submitted") reachedAt.submitted = e.blockTime;
        if (
            e.eventKind === "completed" ||
            e.eventKind === "rejected" ||
            e.eventKind === "expired"
        ) {
            reachedAt.terminal = e.blockTime;
        }
    }
    const isRejected = status === "rejected" || status === "expired";

    return (
        <ol className="flex flex-wrap items-center gap-3 text-sm">
            {STAGES.map((stage) => {
                const reached = reachedAt[stage] !== undefined;
                const isTerminal = stage === "terminal";
                const Icon = !reached
                    ? Circle
                    : isTerminal && isRejected
                      ? XCircle
                      : isTerminal
                        ? CheckCircle2
                        : Clock;
                return (
                    <li
                        key={stage}
                        className={cn(
                            "flex items-center gap-2 rounded-md border px-3 py-1.5",
                            reached
                                ? isTerminal && isRejected
                                    ? "border-state-rejected/40 text-state-rejected"
                                    : "border-state-completed/40 text-state-completed"
                                : "border-border/40 text-muted-foreground",
                        )}
                    >
                        <Icon className="size-4" />
                        <span className="capitalize">{stage}</span>
                        {reachedAt[stage] && (
                            <time className="font-mono text-xs text-muted-foreground">
                                {new Date(reachedAt[stage]!).toLocaleString()}
                            </time>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
