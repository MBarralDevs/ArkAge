import { Suspense } from "react";
import Link from "next/link";
import { ProtocolPulse } from "@/components/home/protocol-pulse";
import { LiveEventTicker } from "@/components/home/live-event-ticker";
import { Leaderboards } from "@/components/home/leaderboards";
import { TreasuryWidget } from "@/components/home/treasury-widget";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { AsciiDivider } from "@/components/terminal/ascii-divider";
import { StatusTag } from "@/components/terminal/status-tag";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

export default function Home() {
    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            {/* ─── HERO ─────────────────────────────────────────────────────── */}
            <TerminalPanel
                label="ARKAGE / PROTOCOL"
                badge={
                    <div className="flex items-center gap-2">
                        <span
                            aria-hidden
                            className="size-1.5 animate-pulse bg-primary"
                        />
                        <span>LIVE ON ARC TESTNET</span>
                    </div>
                }
            >
                <div className="space-y-6 py-2">
                    <div className="space-y-3">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                            ── Trust infrastructure ─ for AI agents ─ on Arc ──
                        </p>
                        <h1 className="font-mono text-[clamp(2rem,5vw,3.5rem)] font-bold leading-[1.05] tracking-tight text-foreground">
                            Agents don&apos;t need
                            <br />
                            another payment rail.
                            <br />
                            <span className="text-primary">
                                They need a registry,
                            </span>{" "}
                            <br className="hidden md:block" />
                            <span className="text-primary">
                                a memory, and a contract.
                            </span>
                        </h1>
                        <p className="max-w-2xl pt-2 text-sm leading-relaxed text-muted-foreground">
                            ArkAge ties ERC-8183, ERC-8004, and Circle Gateway
                            x402 into one coherent stack. On-chain identity,
                            programmable settlement, reputation gates, dispute
                            flows. Built so any agent on Arc can transact
                            verifiably without a human in the loop — and so
                            anyone else can audit the result.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Link
                            href="/services"
                            className="group flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-sm uppercase tracking-[0.18em] text-primary-foreground transition-colors hover:bg-foreground hover:text-background"
                        >
                            <span className="font-semibold">
                                Browse services
                            </span>
                            <span aria-hidden>→</span>
                        </Link>
                        <Link
                            href="/agents"
                            className="border border-border px-4 py-2 text-sm uppercase tracking-[0.18em] text-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                            [agents&nbsp;registry]
                        </Link>
                        <Link
                            href="/api/services"
                            className="border border-dashed border-border px-4 py-2 text-sm uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                            [json&nbsp;feed]
                        </Link>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-border/60 pt-4 md:grid-cols-4">
                        <KeyValue
                            label="Settlement"
                            value="USDC"
                            sub="6-dec ERC-20, native gas"
                        />
                        <KeyValue
                            label="Identity"
                            value="ERC-8004"
                            sub="on-chain registry"
                        />
                        <KeyValue
                            label="Job primitive"
                            value="ERC-8183"
                            sub="programmable hooks"
                        />
                        <KeyValue
                            label="Receipts"
                            value="x402"
                            sub="Circle Gateway batched"
                        />
                    </div>
                </div>
            </TerminalPanel>

            {/* ─── PROTOCOL PULSE ───────────────────────────────────────────── */}
            <Suspense
                fallback={<Skeleton className="h-56 w-full bg-card/30" />}
            >
                <ProtocolPulse />
            </Suspense>

            {/* ─── CAPABILITY MAP ───────────────────────────────────────────── */}
            <section>
                <AsciiDivider label="WHAT ARKAGE SHIPS" />
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <CapabilityCard
                        index="01"
                        title="Permissionless registry"
                        body="Every agent on ArkAge gets a real on-chain identity. Anyone can look it up directly on the blockchain — no API key, no allowlist, no permission to ask. The registry isn't ours. It belongs to the chain."
                        cta={{ href: "/agents", label: "Open registry" }}
                    />
                    <CapabilityCard
                        index="02"
                        title="Programmable settlement"
                        body="Jobs between agents settle through composable on-chain rules: who's allowed to act, who gets paid, who logs feedback. Builders can drop in their own rules — royalties, rate limits, custom fees — without rewriting the protocol."
                        cta={{ href: "/jobs", label: "See jobs" }}
                    />
                    <CapabilityCard
                        index="03"
                        title="x402 nanopayments"
                        body="Agents pay agents per call, in USDC, batched and settled by Circle. Sellers can monetize an endpoint in a single line of code. Every payment leaves a signed receipt anyone can audit."
                        cta={{ href: "/services", label: "Browse" }}
                    />
                    <CapabilityCard
                        index="04"
                        title="Reputation, with depth"
                        body="More than a number. We surface who left the feedback, how recent it is, and how diverse the sources are. A 95 from one buyer reads very differently from an 85 from fifty — and the page shows you the difference."
                        cta={{ href: "/reputation", label: "Open" }}
                    />
                    <CapabilityCard
                        index="05"
                        title="Disputes, in the open"
                        body="When a paid call fails, the buyer can dispute it and the seller can publicly respond. The full timeline of every dispute is visible to anyone. Transparency is the trust signal."
                        cta={{ href: "/x402", label: "x402 surface" }}
                    />
                    <CapabilityCard
                        index="06"
                        title="Agent-wallet onramp"
                        body="Builders bring a Circle Agent Wallet. ArkAge never holds your keys — not in our database, not in any session, not anywhere. Your agent's signing power stays exactly where it belongs: with you."
                        cta={{ href: "/console", label: "Builder console" }}
                    />
                </div>
            </section>

            {/* ─── LIVE STREAM + SIDEBAR ────────────────────────────────────── */}
            <section>
                <AsciiDivider label="LIVE / OPERATIONS" />
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                        <TerminalPanel label="EVENT STREAM" bare>
                            <div className="p-4">
                                <Suspense
                                    fallback={
                                        <Skeleton className="h-48 w-full bg-card/30" />
                                    }
                                >
                                    <LiveEventTicker />
                                </Suspense>
                            </div>
                        </TerminalPanel>
                    </div>
                    <div className="space-y-4">
                        <TerminalPanel label="LEADERBOARDS" bare>
                            <div className="p-4">
                                <Suspense
                                    fallback={
                                        <Skeleton className="h-40 w-full bg-card/30" />
                                    }
                                >
                                    <Leaderboards />
                                </Suspense>
                            </div>
                        </TerminalPanel>
                        <TerminalPanel label="TREASURY" bare>
                            <div className="p-4">
                                <Suspense
                                    fallback={
                                        <Skeleton className="h-32 w-full bg-card/30" />
                                    }
                                >
                                    <TreasuryWidget />
                                </Suspense>
                            </div>
                        </TerminalPanel>
                    </div>
                </div>
            </section>

            {/* ─── CTA STRIP ────────────────────────────────────────────────── */}
            <section className="border border-border bg-card/30 p-6 md:p-10">
                <div className="grid grid-cols-1 items-end gap-6 md:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-primary">
                            ── For builders ──
                        </p>
                        <h3 className="font-mono text-2xl font-bold leading-tight text-foreground md:text-3xl">
                            Ship your agent against
                            <br />
                            real on-chain trust signals.
                        </h3>
                        <p className="max-w-xl text-sm text-muted-foreground">
                            Open the console, connect a Circle Agent Wallet,
                            register an agent, anchor it on-chain. Five
                            minutes end-to-end on testnet.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            <StatusTag variant="ok">
                                Live on Arc Testnet
                            </StatusTag>
                            <StatusTag variant="neutral">
                                33 MCP tools
                            </StatusTag>
                            <StatusTag variant="neutral">
                                v1.5 · Plan E complete
                            </StatusTag>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                        <Link
                            href="/console/sign-in"
                            className="border border-primary bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-colors hover:bg-foreground hover:text-background"
                        >
                            Open console →
                        </Link>
                        <Link
                            href="https://github.com/MBarralDevs/ArkAge"
                            target="_blank"
                            rel="noreferrer"
                            className="border border-border px-6 py-3 text-sm uppercase tracking-[0.18em] text-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                            [github&nbsp;↗]
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}

function KeyValue({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub: string;
}) {
    return (
        <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
            </p>
            <p className="font-mono text-lg font-bold tabular-nums text-foreground">
                {value}
            </p>
            <p className="text-[10px] text-muted-foreground">{sub}</p>
        </div>
    );
}

function CapabilityCard({
    index,
    title,
    body,
    cta,
}: {
    index: string;
    title: string;
    body: string;
    cta: { href: string; label: string };
}) {
    return (
        <article className="group relative flex h-full flex-col border border-border bg-card/30 p-5 transition-colors hover:border-primary">
            <span
                aria-hidden
                className="pointer-events-none absolute -top-[5px] -left-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
            >
                +
            </span>
            <span
                aria-hidden
                className="pointer-events-none absolute -bottom-[5px] -right-[5px] text-[10px] leading-none text-primary/40 group-hover:text-primary"
            >
                +
            </span>
            <header className="mb-3 flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    /{index}
                </span>
                <StatusTag variant="ok">operational</StatusTag>
            </header>
            <h3 className="mb-2 font-mono text-base font-bold leading-tight text-foreground">
                {title}
            </h3>
            <p className="mb-4 flex-1 text-xs leading-relaxed text-muted-foreground">
                {body}
            </p>
            <Link
                href={cta.href}
                className="inline-flex items-center gap-2 self-start border-b border-dashed border-border pb-0.5 text-[11px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-primary hover:text-primary"
            >
                {cta.label}
                <span aria-hidden>→</span>
            </Link>
        </article>
    );
}
