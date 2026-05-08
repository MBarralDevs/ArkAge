import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TxLink } from "@/components/primitives/tx-link";

interface Entry {
    txHash: string;
    eventKind: string;
    jobId: string;
    blockTime: string;
}

export function TierAwareTxHistory({
    entries,
    tierLabel,
}: {
    entries: Entry[];
    tierLabel: string;
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent activity</CardTitle>
                <Badge variant="outline">Tier {tierLabel}</Badge>
            </CardHeader>
            <CardContent>
                {entries.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        No activity recorded.
                    </p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {entries.map((e) => (
                            <li
                                key={e.txHash + e.eventKind}
                                className="flex items-center justify-between border-b border-border/30 pb-2 last:border-b-0"
                            >
                                <span className="flex items-center gap-3">
                                    <span className="font-mono text-xs uppercase text-muted-foreground">
                                        {e.eventKind}
                                    </span>
                                    <span className="font-mono text-xs">
                                        job #{e.jobId}
                                    </span>
                                </span>
                                <span className="flex items-center gap-3">
                                    <TxLink hash={e.txHash} />
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(e.blockTime).toLocaleString()}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
