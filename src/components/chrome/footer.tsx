import Link from "next/link";
import { activeChain, CHAIN_ID } from "@/lib/chain";

export function Footer() {
    return (
        <footer className="border-t border-border/40 py-8 text-sm text-muted-foreground">
            <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 px-4 md:flex-row md:items-center md:justify-between">
                <p>
                    ArkAge v1 · {activeChain.name} · open protocol on{" "}
                    <Link
                        href="https://github.com/MBarralDevs/ArkAge"
                        className="underline-offset-4 hover:underline"
                    >
                        GitHub
                    </Link>
                </p>
                <p className="font-mono text-xs">
                    chain {CHAIN_ID} · USDC{" "}
                    <code className="rounded bg-muted px-1">0x3600…0000</code>
                </p>
            </div>
        </footer>
    );
}
