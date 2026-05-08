import { listenToChannel } from "@/lib/pg-notify";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-job SSE stream. Subscribes to `arkage:job:<id>` so the
 * `/jobs/[id]` page can render new lifecycle events as they hit
 * Postgres without polling.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) {
        return new Response("bad id", { status: 400 });
    }

    const job = await db.job.findUnique({
        where: { jobId: id },
        select: { id: true },
    });
    if (!job) return new Response("not found", { status: 404 });

    const encoder = new TextEncoder();
    let cleanup: (() => Promise<void>) | null = null;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                try {
                    controller.enqueue(
                        encoder.encode(
                            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                        ),
                    );
                } catch {
                    /* closed */
                }
            };
            send("hello", { jobId: id });

            cleanup = await listenToChannel(
                `arkage:job:${id}`,
                (payload) => send("job_event", payload),
            );

            const keepalive = setInterval(
                () => send("ping", { ts: Date.now() }),
                25_000,
            );
            request.signal.addEventListener("abort", () => {
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
