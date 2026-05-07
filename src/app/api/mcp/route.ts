import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/server";
import { resolveAuthContext } from "@/mcp/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP transport entry point.
 *
 * Uses the SDK's WebStandardStreamableHTTPServerTransport (the canonical
 * Web-Standards transport for Route Handler / Hono / fetch-style runtimes,
 * supports both JSON-response and SSE-stream modes). One transport is
 * spun up per request — the Server is connected, the transport handles
 * the message exchange, and the response stream is returned.
 *
 * Stateless mode (no sessionIdGenerator): each request authenticates
 * independently via the bearer token, no session persistence. Plan C
 * may add sessions for streaming dashboard subscriptions.
 */
export async function POST(request: Request): Promise<Response> {
    const authResult = await resolveAuthContext(request);
    if (!authResult.ok) {
        console.warn("[mcp] rejected", { code: authResult.code });
        return NextResponse.json(
            { ok: false, code: authResult.code, message: authResult.message },
            { status: 401 },
        );
    }

    try {
        const server = createMcpServer(authResult.data);
        // Stateless: omit sessionIdGenerator entirely (per SDK option type;
        // exactOptionalPropertyTypes rejects an explicit `undefined` here).
        const transport = new WebStandardStreamableHTTPServerTransport({
            // Plan A's pattern is JSON request/response. Streaming dashboards
            // (Plan C) will switch to SSE per-route as needed.
            enableJsonResponse: true,
        });
        await server.connect(transport);
        return await transport.handleRequest(request);
    } catch (e) {
        console.error("[mcp] transport failure", {
            builderId: String(authResult.data.builderId),
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
}
