"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Plan E3 — copy the public agent profile URL to the clipboard so builders
 * can share their agent in social posts, marketplaces, or chat.
 *
 * Rendered on `/agents/[id]` (public). Falls back silently if the
 * Clipboard API is unavailable (non-secure context, old browser).
 */
export function ShareAgentButton({ agentId }: { agentId: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            const url =
                typeof window !== "undefined"
                    ? `${window.location.origin}/agents/${agentId}`
                    : `/agents/${agentId}`;
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable */
        }
    }

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            aria-label="Copy profile URL"
        >
            {copied ? "Copied link" : "Share"}
        </Button>
    );
}
