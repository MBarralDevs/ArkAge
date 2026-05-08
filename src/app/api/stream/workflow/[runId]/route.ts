import { getRun } from "workflow/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pass-through proxy for a Vercel Workflow run's readable stream.
 *
 * The evaluator workflow writes UIMessageChunks to namespace
 * `evaluator:reasoning` (Plan B Task 28); the job-detail page
 * subscribes here to render the LLM's reasoning live.
 *
 * Query params:
 *   ?namespace=<string>   (defaults to the run's default stream)
 *   ?startIndex=<number>  (resume position, default 0)
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
    const { runId } = await params;
    const url = new URL(_request.url);
    const namespace = url.searchParams.get("namespace") ?? undefined;
    const startIndexParam = url.searchParams.get("startIndex");
    const startIndex = startIndexParam ? parseInt(startIndexParam, 10) : 0;

    const run = getRun(runId);
    const readable = run.getReadable({
        ...(namespace !== undefined && { namespace }),
        startIndex,
    });

    return new Response(readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
