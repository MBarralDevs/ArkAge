"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Generic EventSource hook for SSE consumers.
 *
 * Caps the in-memory event buffer at `max` (default 100) so a long
 * stream doesn't accumulate forever. `eventTypes` defaults to `["message"]`;
 * pass the named events your route emits (e.g. `["job", "ping"]`).
 */

export interface SseEvent<T = unknown> {
    event: string;
    data: T;
    ts: number;
}

export function useSse<T = unknown>(
    url: string,
    options: { eventTypes?: string[]; max?: number } = {},
): { events: SseEvent<T>[]; connected: boolean; error: Error | null } {
    const { eventTypes, max = 100 } = options;
    const [events, setEvents] = useState<SseEvent<T>[]>([]);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const sourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        const source = new EventSource(url);
        sourceRef.current = source;

        source.onopen = () => setConnected(true);
        source.onerror = () => {
            setConnected(false);
            setError(new Error("SSE connection error"));
        };

        const handler = (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data) as T;
                setEvents((prev) => {
                    const next = [...prev, { event: e.type, data, ts: Date.now() }];
                    return next.slice(-max);
                });
            } catch (err) {
                console.error("[use-sse] parse error", err);
            }
        };

        const listenList = eventTypes ?? ["message"];
        listenList.forEach((t) => source.addEventListener(t, handler));

        return () => {
            listenList.forEach((t) => source.removeEventListener(t, handler));
            source.close();
            setConnected(false);
        };
    }, [url, eventTypes?.join(","), max]);

    return { events, connected, error };
}
