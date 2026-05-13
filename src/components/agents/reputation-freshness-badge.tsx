import { Badge } from "@/components/ui/badge";

interface Freshness {
    last7d: number;
    last30d: number;
    last90d: number;
    older: number;
}

/**
 * Plan E.2 — at-a-glance "is this agent still active?" signal. A high
 * total score from feedback that hasn't moved in 6 months is meaningfully
 * different from active recent feedback. Three states:
 *
 *   - Active 7d         — ≥ 1 feedback event in the last 7 days
 *   - Recent 30d        — ≥ 1 in last 30 (but none last 7)
 *   - Idle 90d+         — most recent feedback is > 90 days old
 *   - No feedback yet   — empty history
 */
export function ReputationFreshnessBadge({
    freshness,
    className,
}: {
    freshness: Freshness;
    className?: string;
}) {
    const total =
        freshness.last7d +
        freshness.last30d +
        freshness.last90d +
        freshness.older;
    if (total === 0) {
        return (
            <Badge variant="outline" className={className}>
                No feedback yet
            </Badge>
        );
    }
    if (freshness.last7d > 0) {
        return (
            <Badge
                className={className}
                title={`${freshness.last7d} feedback event${freshness.last7d === 1 ? "" : "s"} in the last 7 days`}
            >
                Active 7d
            </Badge>
        );
    }
    if (freshness.last30d > 0) {
        return (
            <Badge
                variant="secondary"
                className={className}
                title={`${freshness.last30d} feedback event${freshness.last30d === 1 ? "" : "s"} in the last 30 days`}
            >
                Recent 30d
            </Badge>
        );
    }
    if (freshness.last90d > 0) {
        return (
            <Badge variant="secondary" className={className} title="Most recent feedback within 90 days">
                Quiet 90d
            </Badge>
        );
    }
    return (
        <Badge
            variant="outline"
            className={className}
            title="No feedback events in the last 90 days"
        >
            Idle 90d+
        </Badge>
    );
}
