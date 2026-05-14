import { cn } from "@/lib/utils";

/**
 * A row of dashes with an optional inline label, mirroring how a CLI
 * section break looks in a long-form output:
 *
 *   ──── PROTOCOL HEALTH ──────────────────────────────────────────────
 *
 * Used to break the landing page into rhythm. Cheap, monospace, ages
 * better than `<hr>`.
 */
export function AsciiDivider({
    label,
    className,
}: {
    label?: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "ascii-line flex items-center gap-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground",
                className,
            )}
        >
            <span aria-hidden className="text-border">
                ─────
            </span>
            {label && <span className="text-primary">{label}</span>}
            <span
                aria-hidden
                className="flex-1 overflow-hidden whitespace-nowrap text-border"
            >
                ────────────────────────────────────────────────────────────────────────────────────────────────────
            </span>
        </div>
    );
}
