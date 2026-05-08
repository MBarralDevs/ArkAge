import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/primitives/money-display";

interface Stats {
    sessions24h: number;
    receipts24h: number;
    volume24h: string;
    activeSessions: number;
}

export function TrafficOverview({ stats }: { stats: Stats }) {
    const cards = [
        { label: "24h sessions", value: stats.sessions24h.toLocaleString() },
        { label: "24h receipts", value: stats.receipts24h.toLocaleString() },
        { label: "24h volume", value: <MoneyDisplay raw={stats.volume24h} /> },
        { label: "Active sessions", value: stats.activeSessions.toLocaleString() },
    ];
    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((c) => (
                <Card key={c.label}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            {c.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold tabular-nums">{c.value}</p>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
