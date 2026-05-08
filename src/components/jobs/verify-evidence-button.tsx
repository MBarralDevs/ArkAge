"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Calls `arkage:verify_evidence` via the MCP HTTP transport. Requires a
 * read-only public token surfaced as `NEXT_PUBLIC_PUBLIC_VERIFY_TOKEN`
 * — without it the call returns 401 and the toast shows the auth error.
 */
export function VerifyEvidenceButton({ jobId }: { jobId: string }) {
    const [loading, setLoading] = useState(false);

    const onClick = async () => {
        setLoading(true);
        try {
            const token = process.env.NEXT_PUBLIC_PUBLIC_VERIFY_TOKEN ?? "";
            const res = await fetch("/api/mcp", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/call",
                    params: {
                        name: "arkage:verify_evidence",
                        arguments: { jobId },
                    },
                }),
            });
            const data = await res.json();
            const inner = JSON.parse(
                data?.result?.content?.[0]?.text ?? "{}",
            );
            if (inner.ok && inner.data?.matches) {
                toast.success(
                    "Evidence verified — on-chain hash matches off-chain JSON.",
                );
            } else {
                toast.error(inner.message ?? "Verification failed.");
            }
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "Verification failed.",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            size="sm"
            variant="outline"
            onClick={onClick}
            disabled={loading}
        >
            {loading ? "Verifying…" : "Verify evidence"}
        </Button>
    );
}
