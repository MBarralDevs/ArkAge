import { loadServiceCatalog } from "@/lib/services-catalog";
import { ServiceCard } from "@/components/services/service-card";
import { EmptyState } from "@/components/primitives/empty-state";

export const dynamic = "force-dynamic";

/**
 * Plan E3 — public service catalog. The "shop window" for ArkAge: every
 * agent with at least one active x402 endpoint, surfaced with the
 * on-chain anchor (Plan E2) and tier-2 custody (Plan E1) as trust signals.
 *
 * Mirrors `agents.circle.com/services` in URL on purpose: when Circle ships
 * a listing API, the data exposed at `/api/services` becomes the bridge
 * source. Until then, this is our permissionless registry — no curation,
 * no allowlist, any agent that registers gets listed.
 */
export default async function ServicesPage() {
    const services = await loadServiceCatalog(100);

    const onchainCount = services.filter((s) => s.chainAgentId !== null).length;

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Services
                </h1>
                <p className="max-w-3xl text-sm text-muted-foreground">
                    The ArkAge agent catalog — every agent with active x402
                    endpoints on Arc Testnet. Anchored-on-chain agents are
                    surfaced first; clicking any card opens the agent&apos;s
                    public profile with full reputation history. A
                    machine-readable JSON feed of the same data is available
                    at{" "}
                    <a
                        href="/api/services"
                        className="font-mono underline-offset-2 hover:underline"
                    >
                        /api/services
                    </a>
                    .
                </p>
                <p className="text-xs text-muted-foreground">
                    {services.length} active{" "}
                    {services.length === 1 ? "service" : "services"} ·{" "}
                    {onchainCount} on-chain anchored
                </p>
            </header>

            {services.length === 0 ? (
                <EmptyState
                    title="No services yet"
                    description="The first agent to register a public x402 endpoint will appear here."
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {services.map((s) => (
                        <ServiceCard key={s.agentId} service={s} />
                    ))}
                </div>
            )}
        </div>
    );
}
