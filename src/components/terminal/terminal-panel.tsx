import { cn } from "@/lib/utils";

/**
 * The hero primitive. A bordered panel with an optional label that sits
 * in the top edge of the border like a fieldset legend — except styled
 * to read as a terminal window title bar.
 *
 *   ┌── LABEL ─────────────────────────────────────────────────────────┐
 *   │                                                                   │
 *   │   children                                                        │
 *   │                                                                   │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * The corners use absolutely-positioned `+` glyphs so they read like
 * ASCII crosshairs without me having to draw fragile box-drawing
 * characters across viewports.
 */
export function TerminalPanel({
    label,
    badge,
    children,
    className,
    bare = false,
}: {
    label?: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    /** When true, no inner padding — useful for tables / dense lists. */
    bare?: boolean;
}) {
    return (
        <section
            className={cn(
                "relative border border-border bg-card/30",
                className,
            )}
        >
            {/* corner crosshairs */}
            <span
                aria-hidden
                className="pointer-events-none absolute -top-[5px] -left-[5px] text-[10px] leading-none text-primary/50"
            >
                +
            </span>
            <span
                aria-hidden
                className="pointer-events-none absolute -top-[5px] -right-[5px] text-[10px] leading-none text-primary/50"
            >
                +
            </span>
            <span
                aria-hidden
                className="pointer-events-none absolute -bottom-[5px] -left-[5px] text-[10px] leading-none text-primary/50"
            >
                +
            </span>
            <span
                aria-hidden
                className="pointer-events-none absolute -bottom-[5px] -right-[5px] text-[10px] leading-none text-primary/50"
            >
                +
            </span>

            {(label || badge) && (
                <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/60 px-3 py-1.5">
                    {label && (
                        <h2 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                            <span className="text-primary">▸</span>
                            {label}
                        </h2>
                    )}
                    {badge && (
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {badge}
                        </div>
                    )}
                </header>
            )}

            <div className={cn(!bare && "p-4")}>{children}</div>
        </section>
    );
}
