import Link from "next/link";
import { NavLink } from "./nav-link";
import { currentBuilder } from "@/lib/auth-context";
import { Address } from "@/components/primitives/address";
import { activeChain, CHAIN_ID } from "@/lib/chain";

/**
 * TUI tab-strip header. Two rows:
 *   Row 1: meta strip — wordmark + chain + status indicator + auth slot
 *   Row 2: nav tabs — terminal-style with active = inverted amber
 */
export async function Header() {
    const builder = await currentBuilder();
    return (
        <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            {/* meta strip */}
            <div className="border-b border-border/60">
                <div className="mx-auto flex h-8 max-w-7xl items-center gap-4 px-4 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    <Link
                        href="/"
                        className="group flex items-center gap-2 text-foreground"
                    >
                        <span
                            aria-hidden
                            className="inline-block size-1.5 bg-primary group-hover:phosphor"
                        />
                        <span className="font-semibold tracking-[0.3em] group-hover:phosphor">
                            ArkAge
                        </span>
                        <span className="text-muted-foreground/70">
                            /v1.5
                        </span>
                    </Link>
                    <span className="text-muted-foreground/40">│</span>
                    <span>
                        {activeChain.name} ·{" "}
                        <span className="text-foreground">{CHAIN_ID}</span>
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                        <span className="flex items-center gap-1.5">
                            <span
                                aria-hidden
                                className="size-1.5 animate-pulse bg-primary"
                            />
                            <span className="text-foreground">READY</span>
                        </span>
                        {builder ? (
                            <>
                                <span className="text-muted-foreground/40">
                                    │
                                </span>
                                <span className="normal-case tracking-normal text-muted-foreground">
                                    <Address
                                        value={builder.primaryWallet}
                                        copyable={false}
                                    />
                                </span>
                                <Link
                                    href="/console"
                                    className="border border-border px-2 py-0.5 text-foreground transition-colors hover:border-primary hover:text-primary"
                                >
                                    [console&nbsp;→]
                                </Link>
                            </>
                        ) : (
                            <Link
                                href="/console/sign-in"
                                className="border border-border px-2 py-0.5 text-foreground transition-colors hover:border-primary hover:text-primary"
                            >
                                [sign&nbsp;in]
                            </Link>
                        )}
                    </span>
                </div>
            </div>

            {/* nav tabs */}
            <div className="mx-auto flex max-w-7xl items-stretch px-4">
                <nav className="flex items-stretch gap-0">
                    <NavLink href="/services">Services</NavLink>
                    <NavLink href="/jobs">Jobs</NavLink>
                    <NavLink href="/agents">Agents</NavLink>
                    <NavLink href="/evaluators">Evaluators</NavLink>
                    <NavLink href="/reputation">Reputation</NavLink>
                    <NavLink href="/x402">x402</NavLink>
                    <NavLink href="/security">Security</NavLink>
                </nav>
            </div>
        </header>
    );
}
