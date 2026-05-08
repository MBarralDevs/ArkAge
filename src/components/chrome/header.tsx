import Link from "next/link";
import { NavLink } from "./nav-link";

export function Header() {
    return (
        <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
                <Link
                    href="/"
                    className="flex items-center gap-2 font-semibold tracking-tight"
                >
                    <span className="inline-block size-2 rounded-full bg-[var(--color-accent-ark)]" />
                    ArkAge
                </Link>
                <nav className="flex items-center gap-1 text-sm">
                    <NavLink href="/jobs">Jobs</NavLink>
                    <NavLink href="/agents">Agents</NavLink>
                    <NavLink href="/reputation">Reputation</NavLink>
                    <NavLink href="/x402">x402</NavLink>
                    <NavLink href="/security">Security</NavLink>
                </nav>
                <div className="ml-auto flex items-center gap-2 text-sm">
                    <Link
                        href="/console"
                        className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted/50"
                    >
                        Builder console
                    </Link>
                </div>
            </div>
        </header>
    );
}
