"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePolling } from "@/hooks/use-polling";
import { EventRow } from "@/components/primitives/event-row";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

interface JobEvt {
    jobId: string;
    eventKind: string;
    blockTime: string;
}

export function LiveEventTicker() {
    const { events, connected } = usePolling<JobEvt>("/api/stream/jobs", {
        max: 12,
        pollMs: 3000,
    });

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Live activity</CardTitle>
                <span
                    className={
                        "size-2 rounded-full " +
                        (connected
                            ? "bg-state-completed animate-pulse"
                            : "bg-state-expired")
                    }
                    aria-label={connected ? "connected" : "disconnected"}
                />
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto">
                <AnimatePresence initial={false}>
                    {[...events].reverse().map((e, i) => (
                        <motion.div
                            key={`${e.data.jobId}-${e.data.eventKind}-${e.ts}-${i}`}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                        >
                            <EventRow
                                message={
                                    <span>
                                        Job{" "}
                                        <code className="font-mono text-xs">
                                            #{e.data.jobId}
                                        </code>{" "}
                                        <span className="text-muted-foreground">
                                            {e.data.eventKind}
                                        </span>
                                    </span>
                                }
                                at={
                                    e.data.blockTime ??
                                    new Date().toISOString()
                                }
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
                {events.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        Waiting for the next event…
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
