"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Props {
    agentId: string;
    current: {
        perTx: string;
        perDay: string;
        perWeek: string;
        allowedContracts: string[];
        denyList: string[];
        minReputation: number | null;
        jobsPerHour: number;
        x402CallsPerMinute: number;
    };
    rawJson: string;
}

export function PolicyEditor({ agentId, current, rawJson }: Props) {
    const router = useRouter();
    const [perTx, setPerTx] = useState(current.perTx);
    const [perDay, setPerDay] = useState(current.perDay);
    const [perWeek, setPerWeek] = useState(current.perWeek);
    const [denyList, setDenyList] = useState(current.denyList.join(","));
    const [busy, setBusy] = useState(false);

    const onSave = async () => {
        setBusy(true);
        try {
            const res = await fetch("/api/actions/update-policy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentId,
                    patch: {
                        spendCaps: { perTx, perDay, perWeek },
                        counterpartyRules: {
                            denyList: denyList
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                        },
                    },
                }),
            });
            if (!res.ok) {
                throw new Error((await res.json()).error ?? "save failed");
            }
            toast.success(
                "Policy updated. Tier 1 signature requested for on-chain commit.",
            );
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "save failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Policy</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="form">
                    <TabsList>
                        <TabsTrigger value="form">Form</TabsTrigger>
                        <TabsTrigger value="json">JSON</TabsTrigger>
                    </TabsList>
                    <TabsContent value="form" className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="perTx">
                                    Per-tx cap (USDC raw)
                                </Label>
                                <Input
                                    id="perTx"
                                    value={perTx}
                                    onChange={(e) => setPerTx(e.target.value)}
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="perDay">Per-day cap</Label>
                                <Input
                                    id="perDay"
                                    value={perDay}
                                    onChange={(e) => setPerDay(e.target.value)}
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="perWeek">Per-week cap</Label>
                                <Input
                                    id="perWeek"
                                    value={perWeek}
                                    onChange={(e) => setPerWeek(e.target.value)}
                                    className="font-mono"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="denyList">
                                Counterparty deny-list (comma-separated
                                addresses)
                            </Label>
                            <Input
                                id="denyList"
                                value={denyList}
                                onChange={(e) => setDenyList(e.target.value)}
                                className="font-mono text-xs"
                            />
                        </div>
                        <Button onClick={onSave} disabled={busy}>
                            {busy
                                ? "Saving…"
                                : "Save & request Tier 1 signature"}
                        </Button>
                    </TabsContent>
                    <TabsContent value="json" className="pt-4">
                        <pre className="max-h-96 overflow-auto rounded-md border border-border/40 bg-muted/30 p-3 font-mono text-xs">
                            <code>{rawJson}</code>
                        </pre>
                        <p className="mt-2 text-xs text-muted-foreground">
                            JSON view is read-only in v1. Use the Form tab to
                            edit.
                        </p>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
