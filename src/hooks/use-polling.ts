"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polling-based live event hook for endpoints that return JSON
 * `{ events: T[], serverTime: number }`.
 *
 * Plan C originally used SSE + Postgres LISTEN/NOTIFY for sub-second
 * updates, but `pg-listen` (transitively `pg-format`) does a runtime
 * `require('./reserved')` that Vercel's serverless tracer can't
 * resolve when the package is in `serverExternalPackages`. We swap
 * the long-lived LISTEN connection for short-poll: 3-5s update
 * latency, no native-module bundling drama.
 *
 * Each poll sends `?since=<unix-ms>` and uses the response's
 * `serverTime` as the cursor for the next request. New events are
 * appended to a capped buffer.
 *
 * Same `{ events, connected, error }` return shape as `useSse`, so
 * dot-indicator UI works identically.
 */

export interface PollingEvent<T = unknown> {
    event: string;
    data: T;
    ts: number;
}

interface PollResponse<T> {
    events: T[];
    serverTime: number;
}

export function usePolling<T = unknown>(
    url: string,
    options: { max?: number; pollMs?: number } = {},
): { events: PollingEvent<T>[]; connected: boolean; error: Error | null } {
    const { max = 100, pollMs = 3000 } = options;
    const [events, setEvents] = useState<PollingEvent<T>[]>([]);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    // Mount time as the initial `since`, so we don't replay history.
    const sinceRef = useRef<number>(Date.now());

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            try {
                const sep = url.includes("?") ? "&" : "?";
                const res = await fetch(
                    `${url}${sep}since=${sinceRef.current}`,
                    { cache: "no-store" },
                );
                if (!res.ok) {
                    throw new Error(`poll failed: HTTP ${res.status}`);
                }
                const body = (await res.json()) as PollResponse<T>;
                if (cancelled) return;

                setConnected(true);
                setError(null);
                if (body.serverTime) sinceRef.current = body.serverTime;

                if (body.events && body.events.length > 0) {
                    const now = Date.now();
                    const newOnes: PollingEvent<T>[] = body.events.map((d) => ({
                        event: "message",
                        data: d,
                        ts: now,
                    }));
                    setEvents((prev) =>
                        [...prev, ...newOnes].slice(-max),
                    );
                }
            } catch (e) {
                if (cancelled) return;
                setConnected(false);
                setError(e instanceof Error ? e : new Error(String(e)));
            }
        };

        // First poll immediately, then on the interval.
        poll();
        const id = setInterval(poll, pollMs);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [url, max, pollMs]);

    return { events, connected, error };
}
