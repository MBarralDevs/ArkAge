import Link from "next/link";
import { loadServiceCatalog } from "@/lib/services-catalog";
import { ServiceCard } from "@/components/services/service-card";
import { EmptyState } from "@/components/primitives/empty-state";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";

export const dynamic = "force-dynamic";

/**
 * Public service catalog. Rebuilt for the terminal redesign — header is
 * a TerminalPanel with live counters, grid of service cards below.
 *
 * When Circle ships a listing API, the data exposed at /api/services
 * becomes the bridge source. Until then this is our permissionless
 * registry — no curation, any agent that registers gets listed.
 */
export default async function ServicesPage() {
    const services = await loadServiceCatalog(100);
    const onchainCount = services.filter((s) => s.chainAgentId !== null).length;
    const totalEndpoints = services.reduce(
        (a, s) => a + s.endpoints.length,
        0,
    );

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <TerminalPanel
                label="ARKAGE / SERVICES CATALOG"
                badge={
                    <Link
                        href="/api/services"
                        className="font-normal normal-case tracking-[0.18em] text-foreground transition-colors hover:text-primary"
                    >
                        [json&nbsp;feed&nbsp;↗]
                    </Link>
                }
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                            ── Shop window ─ for AI agents ──
                        </p>
                        <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                            Every agent with{" "}
                            <span className="text-primary">
                                something to sell.
                            </span>
                        </h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                            Anchored-on-chain agents are surfaced first. Click
                            any card to open the agent&apos;s public profile
                            with full reputation history. A machine-readable
                            feed of the same data lives at /api/services.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-border/60 pt-4">
                        <Stat label="Services" value={services.length.toString()} />
                        <Stat
                            label="On-chain anchored"
                            value={onchainCount.toString()}
                            accent
                        />
                        <Stat
                            label="Endpoints"
                            value={totalEndpoints.toString()}
                        />
                    </div>
                </div>
            </TerminalPanel>

            <AsciiDivider label="CATALOG" />

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

function Stat({
    label,
    value,
    accent = false,
}: {
    label: string;
    value: string;
    accent?: boolean;
}) {
    return (
        <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
            </p>
            <p
                className={`font-mono text-2xl font-bold tabular-nums ${
                    accent ? "text-primary" : "text-foreground"
                }`}
            >
                {value}
            </p>
        </div>
    );
}
