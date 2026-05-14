"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Terminal-style tab link. Active state inverts (amber bg, black fg)
 * with a left-side `▎` cursor; hover gets a phosphor text-shadow.
 */
export function NavLink({
    href,
    children,
}: {
    href: string;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
        <Link
            href={href}
            className={cn(
                "group relative flex items-center px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-colors",
                "border-x border-transparent",
                active
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-primary hover:border-border",
            )}
        >
            {active && (
                <span aria-hidden className="mr-1.5 text-foreground/60">
                    ▎
                </span>
            )}
            <span className={cn(!active && "group-hover:phosphor")}>
                {children}
            </span>
        </Link>
    );
}
