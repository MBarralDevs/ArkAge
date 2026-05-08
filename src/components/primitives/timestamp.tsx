"use client";

import { useEffect, useState } from "react";
import { absoluteTime, relativeTime } from "@/lib/format";

export function Timestamp({ at }: { at: Date | string }) {
    const date = typeof at === "string" ? new Date(at) : at;
    const [label, setLabel] = useState(relativeTime(date));

    useEffect(() => {
        const tick = () => setLabel(relativeTime(date));
        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [date]);

    return (
        <time
            dateTime={date.toISOString()}
            title={absoluteTime(date)}
            className="text-xs text-muted-foreground tabular-nums"
        >
            {label}
        </time>
    );
}
