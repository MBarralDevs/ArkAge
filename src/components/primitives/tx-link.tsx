import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { shortHex } from "@/lib/format";

export function TxLink({ hash }: { hash: string }) {
    return (
        <Link
            href={`https://testnet.arcscan.app/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
        >
            {shortHex(hash)}
            <ExternalLink className="size-3" />
        </Link>
    );
}
