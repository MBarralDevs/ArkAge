"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { shortHex } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AddressProps {
    value: string;
    href?: string;
    className?: string;
    copyable?: boolean;
    full?: boolean;
}

export function Address({
    value,
    href,
    className,
    copyable = true,
    full = false,
}: AddressProps) {
    const [copied, setCopied] = useState(false);
    const display = full ? value : shortHex(value);

    const onCopy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const inner = <span className="font-mono text-xs">{display}</span>;

    return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
            {href ? (
                <Link
                    href={href}
                    className="underline-offset-4 hover:underline"
                >
                    {inner}
                </Link>
            ) : (
                inner
            )}
            {copyable && (
                <button
                    type="button"
                    onClick={onCopy}
                    aria-label="copy address"
                    className="text-muted-foreground hover:text-foreground"
                >
                    {copied ? (
                        <Check className="size-3" />
                    ) : (
                        <Copy className="size-3" />
                    )}
                </button>
            )}
        </span>
    );
}
