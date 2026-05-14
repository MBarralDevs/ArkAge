import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { shortHex } from "@/lib/format";
import { txLink } from "@/lib/chain";

export function TxLink({ hash }: { hash: string }) {
    return (
        <Link
            href={txLink(hash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
        >
            {shortHex(hash)}
            <ExternalLink className="size-3" />
        </Link>
    );
}
