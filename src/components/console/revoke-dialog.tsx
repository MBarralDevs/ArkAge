"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function RevokeDialog({ agentId }: { agentId: string }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const router = useRouter();

    const onConfirm = async () => {
        setBusy(true);
        try {
            const res = await fetch("/api/actions/revoke-agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agentId }),
            });
            if (!res.ok) {
                throw new Error((await res.json()).error ?? "revoke failed");
            }
            toast.success(
                "Agent revoked. Tier 1 signature requested for on-chain deactivate.",
            );
            setOpen(false);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "revoke failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                    Revoke agent
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Revoke agent #{agentId}?</DialogTitle>
                    <DialogDescription>
                        ArkAge stops honoring MCP calls for this agent
                        immediately. Then we&apos;ll request your Tier 1 passkey
                        signature to call <code> AgentRegistry.deactivate</code>{" "}
                        on-chain. Tier 2 wallet funds remain — sweep separately
                        if needed.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? "Revoking…" : "Yes, revoke"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
