import {
    loadProxyEndpoint,
    proxyThroughGateway,
    persistProxyReceipt,
} from "@/lib/x402-seller-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
    request: Request,
    endpointIdRaw: string,
): Promise<Response> {
    if (!/^[0-9]+$/.test(endpointIdRaw)) {
        return new Response("bad endpoint id", { status: 400 });
    }
    const endpoint = await loadProxyEndpoint(BigInt(endpointIdRaw));
    if (!endpoint) {
        return new Response("endpoint not found or not arkage-proxy", {
            status: 404,
        });
    }

    try {
        const outcome = await proxyThroughGateway(endpoint, request);
        if (outcome.paymentSignature) {
            // Fire-and-forget receipt persistence; don't block the response.
            persistProxyReceipt({ endpoint, outcome }).catch((e) =>
                console.error(
                    "[x402-proxy] receipt persist failed",
                    e instanceof Error ? e.message : e,
                ),
            );
        }
        return new Response(outcome.body, {
            status: outcome.status,
            headers: outcome.headers,
        });
    } catch (e) {
        console.error(
            "[x402-proxy] error",
            e instanceof Error ? e.message : e,
        );
        return new Response("proxy error", { status: 502 });
    }
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ endpointId: string }> },
) {
    const { endpointId } = await params;
    return handle(request, endpointId);
}
export async function POST(
    request: Request,
    { params }: { params: Promise<{ endpointId: string }> },
) {
    const { endpointId } = await params;
    return handle(request, endpointId);
}
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ endpointId: string }> },
) {
    const { endpointId } = await params;
    return handle(request, endpointId);
}
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ endpointId: string }> },
) {
    const { endpointId } = await params;
    return handle(request, endpointId);
}
