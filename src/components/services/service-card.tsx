import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";
import { Tier2KindBadge } from "@/components/primitives/tier2-kind-badge";
import { OnchainAnchorBadge } from "@/components/primitives/onchain-anchor-badge";
import { rawUsdcToUsd, type ServiceListing } from "@/lib/services-catalog";

/**
 * Per-agent listing card on the public `/services` catalog. Surfaces the
 * trust signals we earn from on-chain anchoring (Plan E2) alongside the
 * concrete buy signals (price range, endpoint count, reputation).
 */
export function ServiceCard({ service }: { service: ServiceListing }) {
    const { minRaw, maxRaw } = service.priceRange;
    const priceLabel =
        minRaw === maxRaw
            ? rawUsdcToUsd(minRaw)
            : `${rawUsdcToUsd(minRaw)} – ${rawUsdcToUsd(maxRaw)}`;

    const chainAgentIdBig = service.chainAgentId
        ? BigInt(service.chainAgentId)
        : null;
    const identityTxBytes = service.identityRegisterTxHex
        ? Buffer.from(service.identityRegisterTxHex.slice(2), "hex")
        : null;

    return (
        <Link href={`/agents/${service.agentId}`}>
            <Card className="h-full transition-colors hover:bg-muted/30">
                <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base leading-tight">
                            {service.name}
                        </CardTitle>
                        <OnchainAnchorBadge
                            chainAgentId={chainAgentIdBig}
                            identityTxHash={identityTxBytes}
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Tier2KindBadge custody={service.custody} />
                        <Badge variant="secondary" className="text-xs">
                            {service.endpoints.length} endpoint
                            {service.endpoints.length === 1 ? "" : "s"}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                    {service.description && (
                        <p className="text-muted-foreground line-clamp-2">
                            {service.description}
                        </p>
                    )}
                    {service.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {service.capabilities.slice(0, 4).map((c) => (
                                <Badge
                                    key={c}
                                    variant="outline"
                                    className="text-[10px]"
                                >
                                    {c}
                                </Badge>
                            ))}
                        </div>
                    )}
                    <dl className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                        <dt className="text-muted-foreground">Price / call</dt>
                        <dd className="font-mono tabular-nums">{priceLabel}</dd>
                        <dt className="text-muted-foreground">Operator</dt>
                        <dd>
                            <Address value={service.operator} />
                        </dd>
                        <dt className="text-muted-foreground">Reputation</dt>
                        <dd className="font-mono tabular-nums">
                            {service.reputation.feedbackCount === 0
                                ? "no feedback yet"
                                : `${service.reputation.feedbackCount} · avg ${
                                      service.reputation.averageScore != null
                                          ? service.reputation.averageScore.toFixed(2)
                                          : "—"
                                  }`}
                        </dd>
                    </dl>
                </CardContent>
            </Card>
        </Link>
    );
}
