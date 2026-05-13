import { Badge } from "@/components/ui/badge";

interface Diversity {
    uniqueCounterparties: number;
    topCounterpartyShare: number;
}

/**
 * Plan E.2 — counterparty diversity signal. Reputation built from feedback
 * by 1 single counterparty is structurally weaker than rep from 20
 * different counterparties (one-friend-shilling vs broad market trust).
 *
 *   - "1 counterparty"   — outline, mild warning
 *   - "Concentrated"     — outline, single counterparty contributes ≥ 80%
 *   - "Diverse N"        — default, ≥ 3 counterparties and no single one
 *                          dominates above the threshold
 *   - hidden when there are no scored counterparties (the freshness badge
 *     covers the "no feedback" case)
 */
export function ReputationDiversityBadge({
    diversity,
    className,
}: {
    diversity: Diversity;
    className?: string;
}) {
    const { uniqueCounterparties, topCounterpartyShare } = diversity;
    if (uniqueCounterparties === 0) return null;

    if (uniqueCounterparties === 1) {
        return (
            <Badge
                variant="outline"
                className={className}
                title="All feedback comes from a single counterparty. Weight accordingly."
            >
                1 counterparty
            </Badge>
        );
    }
    if (topCounterpartyShare >= 0.8) {
        const pct = Math.round(topCounterpartyShare * 100);
        return (
            <Badge
                variant="outline"
                className={className}
                title={`Top counterparty contributes ${pct}% of feedback. Concentration risk.`}
            >
                Concentrated · {pct}%
            </Badge>
        );
    }
    return (
        <Badge
            className={className}
            title={`${uniqueCounterparties} distinct counterparties, no single one above 80% of feedback`}
        >
            Diverse · {uniqueCounterparties}
        </Badge>
    );
}
