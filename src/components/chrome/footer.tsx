import Link from "next/link";
import { activeChain, CHAIN_ID, addressLink } from "@/lib/chain";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

/**
 * Status-line footer. Reads like the bottom strip of a vim/tmux session:
 *   left  — chain + protocol version
 *   mid   — USDC contract pin
 *   right — repo link + a "session id" gag (real value: current year)
 */
export function Footer() {
    return (
        <footer className="mt-12 border-t border-border bg-background">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:flex-row md:items-center md:justify-between">
                <p className="flex items-center gap-2">
                    <span
                        aria-hidden
                        className="inline-block size-1.5 bg-primary"
                    />
                    <span className="text-foreground">
                        {activeChain.name}
                    </span>
                    <span className="text-muted-foreground/40">│</span>
                    <span>
                        chain{" "}
                        <span className="text-foreground">{CHAIN_ID}</span>
                    </span>
                    <span className="text-muted-foreground/40">│</span>
                    <span>arkage / v1.5</span>
                </p>
                <p className="flex items-center gap-2">
                    <span>usdc</span>
                    <Link
                        href={addressLink(USDC_ADDRESS)}
                        target="_blank"
                        rel="noreferrer"
                        className="normal-case tracking-normal text-foreground transition-colors hover:text-primary"
                    >
                        0x3600…0000
                    </Link>
                </p>
                <p className="flex items-center gap-2">
                    <Link
                        href="https://github.com/MBarralDevs/ArkAge"
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground transition-colors hover:text-primary"
                    >
                        [github&nbsp;↗]
                    </Link>
                    <span className="text-muted-foreground/40">│</span>
                    <span>session 2026</span>
                </p>
            </div>
        </footer>
    );
}
