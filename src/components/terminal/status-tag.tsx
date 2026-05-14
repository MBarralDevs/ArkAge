import { cn } from "@/lib/utils";

/**
 * Text-tag status indicator. Replaces shadcn `Badge` in places where the
 * terminal aesthetic needs to read explicitly. The bracketed form
 * (`[OK]`, `[!]`, `[~]`, `[X]`) is intentional — it's how a CLI would
 * surface the same information.
 *
 * Variants map to ArkAge's actual state vocabulary:
 *   ok       — completed, anchored, healthy
 *   warn     — open dispute, pending, degraded
 *   crit     — rejected, reverted, blocked
 *   muted    — draft, no data, off-chain
 *   neutral  — info / metadata / "n/a"
 */
type Variant = "ok" | "warn" | "crit" | "muted" | "neutral";

const VARIANTS: Record<Variant, { wrap: string; mark: string }> = {
    ok: {
        wrap: "text-primary",
        mark: "OK",
    },
    warn: {
        wrap: "text-primary",
        mark: "!",
    },
    crit: {
        wrap: "text-destructive",
        mark: "X",
    },
    muted: {
        wrap: "text-muted-foreground/70",
        mark: "~",
    },
    neutral: {
        wrap: "text-foreground/80",
        mark: "·",
    },
};

export function StatusTag({
    variant = "neutral",
    children,
    mark,
    title,
    className,
}: {
    variant?: Variant;
    children: React.ReactNode;
    /** Override the default mark glyph. */
    mark?: string;
    /** Native HTML title attr — shows on hover for tooltips. */
    title?: string;
    className?: string;
}) {
    const v = VARIANTS[variant];
    return (
        <span
            title={title}
            className={cn(
                "inline-flex items-center gap-1.5 border border-current/30 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em]",
                v.wrap,
                className,
            )}
        >
            <span aria-hidden className="opacity-80">
                [{mark ?? v.mark}]
            </span>
            <span>{children}</span>
        </span>
    );
}
