import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";

interface Props {
    agentId: string;
    operator: string;
    active: boolean;
    metadata: { name?: string; description?: string } | null;
    feedbackCount: number;
}

export function AgentCard({
    agentId,
    operator,
    active,
    metadata,
    feedbackCount,
}: Props) {
    return (
        <Link href={`/console/agents/${agentId}`}>
            <Card className="transition-colors hover:bg-muted/30">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base">
                        {metadata?.name ?? `Agent #${agentId}`}
                    </CardTitle>
                    <Badge variant={active ? "default" : "outline"}>
                        {active ? "active" : "inactive"}
                    </Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                    {metadata?.description && (
                        <p className="text-muted-foreground line-clamp-2">
                            {metadata.description}
                        </p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                        <span className="text-muted-foreground">Operator</span>
                        <Address value={operator} />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                            Feedback events
                        </span>
                        <span className="font-mono tabular-nums">
                            {feedbackCount}
                        </span>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
