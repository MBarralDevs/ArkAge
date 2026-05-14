import { cn } from "@/lib/utils";

/**
 * A label / value row sized for dense terminal-style display. Used to
 * compose stat tables on the landing page + agent profiles without
 * defaulting to `<dl>` everywhere (which kills tabular alignment).
 *
 * Visual:
 *   AGENTS REGISTERED ········· 12
 *   ANCHORED ON-CHAIN ·········  3
 */
export function DataRow({
    label,
    value,
    accent = false,
    className,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    /** Emphasize the value with the primary amber. */
    accent?: boolean;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex items-baseline justify-between gap-3 border-b border-dashed border-border/40 py-1.5 last:border-b-0",
                className,
            )}
        >
            <dt className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
            </dt>
            <dd
                className={cn(
                    "font-mono text-sm tabular-nums",
                    accent ? "text-primary" : "text-foreground",
                )}
            >
                {value}
            </dd>
        </div>
    );
}
