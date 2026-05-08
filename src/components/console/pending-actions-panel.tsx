"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Address } from "@/components/primitives/address";

interface Pending {
    reason: string;
    unsignedTx: { to: string; data: string; value: string };
    createdAt: string;
}

export function PendingActionsPanel({ pending }: { pending: Pending[] }) {
    if (pending.length === 0) return null;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    Pending Tier 1 signatures
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2 text-sm">
                    {pending.map((p, i) => (
                        <li
                            key={i}
                            className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-2 last:border-b-0"
                        >
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    {p.reason}
                                </span>
                                <span className="flex items-center gap-2 text-xs">
                                    <span>to</span>
                                    <Address value={p.unsignedTx.to} />
                                </span>
                            </div>
                            <Button size="sm" variant="outline">
                                Sign
                            </Button>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                    Tier 1 signing UI calls into Circle Modular passkey
                    ceremony. Wired in v1.5; for v1, use the MCP{" "}
                    <code>arkage:revoke_agent</code> response payload.
                </p>
            </CardContent>
        </Card>
    );
}
