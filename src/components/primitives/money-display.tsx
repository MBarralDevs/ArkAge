import { formatUsdc6 } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
    raw: bigint | string | null | undefined;
    className?: string;
    zeroFallback?: string;
}

export function MoneyDisplay({ raw, className, zeroFallback = "—" }: Props) {
    if (raw === null || raw === undefined) {
        return <span className={className}>{zeroFallback}</span>;
    }
    const big = typeof raw === "string" ? BigInt(raw) : raw;
    if (big === 0n) return <span className={className}>{zeroFallback}</span>;
    return (
        <span className={cn("font-mono tabular-nums", className)}>
            {formatUsdc6(big)}
        </span>
    );
}
