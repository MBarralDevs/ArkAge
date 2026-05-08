"use client";

import { useSse } from "@/hooks/use-sse";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Chunk {
    type?: string;
    text?: string;
    delta?: string;
}

export function WorkflowStreamViewer({ runId }: { runId: string }) {
    const { events, connected } = useSse<Chunk>(
        `/api/stream/workflow/${runId}?namespace=evaluator:reasoning`,
        { eventTypes: ["message"], max: 200 },
    );

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                    Live evaluator reasoning
                </CardTitle>
                <span
                    className={
                        "size-2 rounded-full " +
                        (connected
                            ? "bg-state-completed"
                            : "bg-state-expired")
                    }
                />
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-72 rounded-md border border-border/40 bg-muted/20 p-3 font-mono text-xs leading-relaxed">
                    {events.length === 0 ? (
                        <p className="text-muted-foreground">
                            Awaiting evaluator output…
                        </p>
                    ) : (
                        <pre className="whitespace-pre-wrap">
                            {events
                                .map(
                                    (e) =>
                                        e.data?.delta ?? e.data?.text ?? "",
                                )
                                .join("")}
                        </pre>
                    )}
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
