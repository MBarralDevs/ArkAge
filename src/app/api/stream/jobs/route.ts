import { listenToChannel } from "@/lib/pg-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of all job events. Public — driven by Postgres LISTEN
 * `arkage:jobs` (fired post-commit from the job_events INSERT trigger).
 *
 * Vercel Functions kill idle SSE after ~30s of inactivity, so we ping
 * every 25s to keep the connection alive within the function timeout.
 * AbortSignal handler ensures we unlistenAll on client disconnect so
 * we don't leak Postgres LISTEN connections.
 */
export async function GET(request: Request): Promise<Response> {
    const encoder = new TextEncoder();

    let closed = false;
    let cleanup: (() => Promise<void>) | null = null;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                if (closed) return;
                try {
                    controller.enqueue(
                        encoder.encode(
                            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                        ),
                    );
                } catch {
                    /* controller closed */
                }
            };

            send("hello", { ts: Date.now() });

            cleanup = await listenToChannel<{
                jobId: string;
                eventKind: string;
            }>("arkage:jobs", (payload) => send("job", payload));

            const keepalive = setInterval(
                () => send("ping", { ts: Date.now() }),
                25_000,
            );

            request.signal.addEventListener("abort", () => {
                closed = true;
                clearInterval(keepalive);
                cleanup?.();
                try {
                    controller.close();
                } catch {
                    /* already closed */
                }
            });
        },
        cancel() {
            closed = true;
            cleanup?.();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
