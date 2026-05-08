import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/primitives/money-display";

interface Endpoint {
    id: string;
    url: string;
    pricePerCall: string;
    hosting: string;
    active: boolean;
}

export function X402EndpointsList({ endpoints }: { endpoints: Endpoint[] }) {
    if (endpoints.length === 0) return null;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">x402 endpoints</CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2 text-sm">
                    {endpoints.map((e) => (
                        <li
                            key={e.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-2 last:border-b-0"
                        >
                            <code className="font-mono text-xs">{e.url}</code>
                            <span className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>{e.hosting}</span>
                                <MoneyDisplay raw={e.pricePerCall} />
                            </span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
