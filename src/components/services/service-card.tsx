import Link from "next/link";
import { Address } from "@/components/primitives/address";
import { Tier2KindBadge } from "@/components/primitives/tier2-kind-badge";
import { OnchainAnchorBadge } from "@/components/primitives/onchain-anchor-badge";
import { StatusTag } from "@/components/terminal/status-tag";
import { rawUsdcToUsd, type ServiceListing } from "@/lib/services-catalog";

/**
 * Per-agent listing card on /services. Rebuilt for session 2 of the
 * terminal redesign — bordered panel with `+` corner crosshairs, header
 * row hosts trust signals (anchor + custody), body is a dense data
 * grid. Hover bumps the border to amber so the catalog feels alive when
 * scanned.
 */
export function ServiceCard({ service }: { service: ServiceListing }) {
    const hasEndpoints = service.endpoints.length > 0;
    const { minRaw, maxRaw } = service.priceRange;
    const priceLabel = !hasEndpoints
        ? "PROFILE ONLY"
        : minRaw === maxRaw
          ? rawUsdcToUsd(minRaw)
          : `${rawUsdcToUsd(minRaw)} – ${rawUsdcToUsd(maxRaw)}`;

    const chainAgentIdBig = service.chainAgentId
        ? BigInt(service.chainAgentId)
        : null;
    const identityTxBytes = service.identityRegisterTxHex
        ? Buffer.from(service.identityRegisterTxHex.slice(2), "hex")
        : null;

    return (
        <Link href={`/agents/${service.agentId}`} className="block h-full">
            <article className="group relative flex h-full flex-col border border-border bg-card/30 transition-colors hover:border-primary">
                <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[5px] -left-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                >
                    +
                </span>
                <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[5px] -right-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                >
                    +
                </span>
                <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-[5px] -left-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                >
                    +
                </span>
                <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-[5px] -right-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
                >
                    +
                </span>

                {/* header band — agent id + anchor */}
                <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/60 px-4 py-2 text-[10px] uppercase tracking-[0.18em]">
                    <span className="text-muted-foreground">
                        agent{" "}
                        <span className="text-foreground">
                            #{service.agentId}
                        </span>
                    </span>
                    <OnchainAnchorBadge
                        chainAgentId={chainAgentIdBig}
                        identityTxHash={identityTxBytes}
                    />
                </header>

                {/* title + description */}
                <div className="space-y-2 px-4 py-3">
                    <h3 className="font-mono text-base font-bold leading-tight text-foreground group-hover:text-primary">
                        {service.name}
                    </h3>
                    {service.description && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {service.description}
                        </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Tier2KindBadge custody={service.custody} />
                        {hasEndpoints ? (
                            <StatusTag variant="ok" mark="·">
                                {service.endpoints.length} endpoint
                                {service.endpoints.length === 1 ? "" : "s"}
                            </StatusTag>
                        ) : (
                            <StatusTag variant="muted">
                                No endpoints
                            </StatusTag>
                        )}
                        {service.disputes.open > 0 && (
                            <StatusTag
                                variant="warn"
                                title={`Total disputes: ${service.disputes.total}`}
                            >
                                {service.disputes.open} open dispute
                                {service.disputes.open === 1 ? "" : "s"}
                            </StatusTag>
                        )}
                    </div>
                </div>

                {/* dense data grid */}
                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/60 px-4 py-3 text-[11px]">
                    <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Price / call
                    </dt>
                    <dd className="text-right font-mono tabular-nums text-primary">
                        {priceLabel}
                    </dd>
                    <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Operator
                    </dt>
                    <dd className="text-right">
                        <Address value={service.operator} />
                    </dd>
                    <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Reputation
                    </dt>
                    <dd className="text-right font-mono tabular-nums text-foreground">
                        {service.reputation.feedbackCount === 0
                            ? "—"
                            : `${service.reputation.feedbackCount} · ${
                                  service.reputation.averageScore != null
                                      ? service.reputation.averageScore.toFixed(
                                            2,
                                        )
                                      : "—"
                              }`}
                    </dd>
                </dl>

                {service.capabilities.length > 0 && (
                    <div className="border-t border-border/60 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <span className="text-foreground">
                            {service.capabilities.slice(0, 4).join(" · ")}
                            {service.capabilities.length > 4 && " · …"}
                        </span>
                    </div>
                )}
            </article>
        </Link>
    );
}
