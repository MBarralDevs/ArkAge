import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Address } from "@/components/primitives/address";
import { Badge } from "@/components/ui/badge";

interface Props {
    agentId: string;
    identityOwner: string;
    operator: string;
    active: boolean;
    metadata: {
        name?: string;
        description?: string;
        capabilities?: string[];
        version?: string;
    } | null;
}

export function IdentityCard({
    agentId,
    identityOwner,
    operator,
    active,
    metadata,
}: Props) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                    {metadata?.name ?? `Agent #${agentId}`}
                </CardTitle>
                <Badge variant={active ? "default" : "outline"}>
                    {active ? "active" : "inactive"}
                </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                {metadata?.description && (
                    <p className="text-muted-foreground">
                        {metadata.description}
                    </p>
                )}
                {metadata?.capabilities && metadata.capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {metadata.capabilities.map((c) => (
                            <Badge
                                key={c}
                                variant="secondary"
                                className="text-xs"
                            >
                                {c}
                            </Badge>
                        ))}
                    </div>
                )}
                <dl className="grid grid-cols-1 gap-2 pt-2 text-xs sm:grid-cols-2">
                    <div>
                        <dt className="text-muted-foreground">
                            Identity owner
                        </dt>
                        <dd>
                            <Address value={identityOwner} />
                        </dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">
                            Operator wallet
                        </dt>
                        <dd>
                            <Address value={operator} />
                        </dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Agent id</dt>
                        <dd className="font-mono">#{agentId}</dd>
                    </div>
                    {metadata?.version && (
                        <div>
                            <dt className="text-muted-foreground">Version</dt>
                            <dd className="font-mono">{metadata.version}</dd>
                        </div>
                    )}
                </dl>
            </CardContent>
        </Card>
    );
}
