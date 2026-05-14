import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { db } from "./db";
import { recordReceiptForSession } from "./x402-receipt-store";
import { openOrJoinSession } from "./x402-session-manager";
import { CAIP2 as ARC_TESTNET_CAIP2 } from "./chain";
import type { Address } from "viem";

/**
 * `hosting=arkage-proxy` adapter for sellers who don't run their own
 * x402 middleware. The proxy route at `/api/x402-proxy/[endpointId]`
 * loads the endpoint, runs Circle's Express middleware against the
 * inbound request, and forwards verified requests to the seller's
 * upstream URL.
 *
 * SDK shape (verified against `@circle-fin/x402-batching@3.0.4`):
 *   - `createGatewayMiddleware({ sellerAddress, networks?, facilitatorUrl? })`
 *     returns `{ require(price): MiddlewareFunction, verify, settle }`.
 *   - `gateway.require("$0.01")` returns the middleware that issues the
 *     402 challenge for unpaid requests and calls `next()` with
 *     `req.payment = { verified, payer, amount, network, transaction? }`
 *     once payment verifies.
 *
 * `networks` uses CAIP-2 strings (e.g. Arc Testnet's `5042002` becomes
 * `eip155:5042002`). The exact value is sourced from `chain.ts` so the
 * mainnet flip is a one-file edit.
 */

export interface ProxyEndpoint {
    endpointId: bigint;
    sellerAgentDbId: bigint;
    upstreamUrl: string;
    pricePerCall: string;
    sellerWallet: Address;
}

export async function loadProxyEndpoint(
    endpointId: bigint,
): Promise<ProxyEndpoint | null> {
    const row = await db.x402Endpoint.findUnique({
        where: { id: endpointId },
        include: {
            sellerAgent: { include: { currentOperatorWallet: true } },
        },
    });
    if (!row || !row.active || row.hosting !== "arkage-proxy") return null;
    return {
        endpointId: row.id,
        sellerAgentDbId: row.sellerAgentId,
        upstreamUrl: row.url,
        pricePerCall: row.pricePerCall.toString(),
        sellerWallet: ("0x" +
            Buffer.from(
                row.sellerAgent.currentOperatorWallet.address,
            ).toString("hex")) as Address,
    };
}

export interface ProxyOutcome {
    status: number;
    body: ArrayBuffer;
    headers: Headers;
    paymentSignature?: `0x${string}`;
    amountPaid?: bigint;
    buyerWallet?: Address;
}

interface CapturedResponse {
    status: number;
    headers: Record<string, string>;
    body: ArrayBuffer;
}

interface CapturedPayment {
    payer: string;
    amount: string;
    transaction?: string;
}

/**
 * Run Circle's Express middleware against a Web Fetch `Request`,
 * forward the verified request to the seller's upstream, and return
 * the proxied response plus extracted payment metadata.
 */
export async function proxyThroughGateway(
    endpoint: ProxyEndpoint,
    request: Request,
): Promise<ProxyOutcome> {
    // Circle's middleware defaults to https://gateway-api.circle.com
    // (mainnet), which doesn't list testnet networks → would return
    // HTTP 503 "No payment networks available" for Arc Testnet
    // (only the testnet facilitator lists Arc's CAIP-2). Default below
    // is the testnet facilitator; mainnet promotion sets
    // ARKAGE_X402_FACILITATOR_URL via env.
    const facilitatorUrl =
        process.env.ARKAGE_X402_FACILITATOR_URL ??
        "https://gateway-api-testnet.circle.com";
    const gateway = createGatewayMiddleware({
        sellerAddress: endpoint.sellerWallet,
        networks: ARC_TESTNET_CAIP2,
        facilitatorUrl,
    });
    const guard = gateway.require(formatPriceUsd(endpoint.pricePerCall));

    const reqLike = await webRequestToExpressLike(request);

    let captured: CapturedResponse | null = null;
    let nextCalled = false;
    let payment: CapturedPayment | undefined;

    await new Promise<void>((resolve) => {
        const resLike = makeExpressResLike((payload) => {
            captured = payload;
            resolve();
        });
        const next = () => {
            nextCalled = true;
            payment = (
                reqLike as {
                    payment?: {
                        verified: boolean;
                        payer: string;
                        amount: string;
                        transaction?: string;
                    };
                }
            ).payment;
            resolve();
        };
        Promise.resolve(
            (
                guard as unknown as (
                    req: unknown,
                    res: unknown,
                    n: () => void,
                ) => void | Promise<void>
            )(reqLike, resLike, next),
        ).catch(() => resolve());
    });

    // 402 path — middleware sent the response itself; relay as-is.
    if (!nextCalled && captured) {
        const cap = captured as CapturedResponse;
        // Forensic log when the middleware returned an error (e.g. Circle's
        // facilitator said "Payment verification failed"). The body is JSON
        // with `error` + `reason` per the SDK's `gateway.require()` impl.
        if (cap.status >= 400) {
            try {
                const text = new TextDecoder().decode(cap.body);
                console.log(
                    `[x402-proxy] middleware returned ${cap.status}: ${text}`,
                );
            } catch {
                /* body not decodable */
            }
        }
        return {
            status: cap.status,
            body: cap.body,
            headers: new Headers(cap.headers),
        };
    }

    // next() was called — payment verified. Forward to upstream.
    const isBodyless =
        request.method === "GET" || request.method === "HEAD";
    const upstream = await fetch(endpoint.upstreamUrl, {
        method: request.method,
        headers: stripPaymentHeaders(request.headers),
        ...(isBodyless ? {} : { body: await request.arrayBuffer() }),
    });

    const upstreamBody = await upstream.arrayBuffer();
    const outHeaders = new Headers(upstream.headers);
    // undici's `await upstream.arrayBuffer()` auto-decompresses brotli/gzip
    // payloads, but `upstream.headers` still claims the original encoding.
    // Relaying the encoding header would make the buyer try to decompress
    // already-uncompressed bytes — surfaces as "Decompression failed" /
    // "terminated" on the SDK side. Strip both encoding markers and the
    // (now-stale) content-length.
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");
    if (captured) {
        const cap = captured as CapturedResponse;
        if (cap.headers["payment-response"]) {
            outHeaders.set(
                "payment-response",
                cap.headers["payment-response"],
            );
        }
    }

    const result: ProxyOutcome = {
        status: upstream.status,
        body: upstreamBody,
        headers: outHeaders,
    };
    if (payment) {
        // SDK exposes payer + amount + transaction; Circle's facilitator
        // webhook is the canonical source of the actual signature, so
        // proxy-side receipts persist amount/payer and let the webhook
        // fill in the signature later.
        result.amountPaid = BigInt(payment.amount);
        result.buyerWallet = payment.payer as Address;
        result.paymentSignature = ("0x" +
            (payment.transaction ?? "")
                .replace(/^0x/, "")
                .padEnd(64, "0")) as `0x${string}`;
    }
    return result;
}

export async function persistProxyReceipt(args: {
    endpoint: ProxyEndpoint;
    outcome: ProxyOutcome;
}): Promise<{ receiptDbId: bigint } | null> {
    const { endpoint, outcome } = args;
    if (
        !outcome.paymentSignature ||
        !outcome.buyerWallet ||
        !outcome.amountPaid
    ) {
        return null;
    }

    const buyerWalletBytes = Buffer.from(
        outcome.buyerWallet.replace(/^0x/, ""),
        "hex",
    );
    const buyerWallet = await db.wallet.findUnique({
        where: { address: buyerWalletBytes },
    });
    if (!buyerWallet) {
        await db.auditLog.create({
            data: {
                actorKind: "system",
                actorId: "x402-proxy",
                action: "receipt.unknown_buyer",
                targetKind: "endpoint",
                targetId: endpoint.endpointId.toString(),
                payloadJsonb: {
                    buyer: outcome.buyerWallet,
                    amount: outcome.amountPaid.toString(),
                } as object,
            },
        });
        return null;
    }

    const buyerAgent = await db.agent.findFirst({
        where: { currentOperatorWalletId: buyerWallet.id },
    });
    if (!buyerAgent) return null;

    const session = await openOrJoinSession(
        buyerAgent.id,
        endpoint.sellerAgentDbId,
    );
    const recorded = await recordReceiptForSession({
        sessionDbId: session.sessionDbId,
        endpointId: endpoint.endpointId,
        amount: outcome.amountPaid,
        paymentSignature: outcome.paymentSignature,
        buyerWallet: outcome.buyerWallet,
        sellerWallet: endpoint.sellerWallet,
        httpStatus: outcome.status,
    });
    return { receiptDbId: recorded.receiptDbId };
}

// ---- internals ----

function formatPriceUsd(rawUsdc: string): string {
    const big = BigInt(rawUsdc);
    const whole = big / 1_000_000n;
    const fracStr =
        (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") ||
        "0";
    return `$${whole}.${fracStr}`;
}

async function webRequestToExpressLike(
    req: Request,
): Promise<Record<string, unknown>> {
    const url = new URL(req.url);
    return {
        method: req.method,
        url: url.pathname + url.search,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(req.headers.entries()),
        body:
            req.method === "GET" || req.method === "HEAD"
                ? undefined
                : await req
                      .clone()
                      .json()
                      .catch(() => undefined),
    };
}

function toArrayBuffer(data: unknown): ArrayBuffer {
    if (data === undefined || data === null) return new ArrayBuffer(0);
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Uint8Array) {
        const ab = new ArrayBuffer(data.byteLength);
        new Uint8Array(ab).set(data);
        return ab;
    }
    const u8 = new TextEncoder().encode(
        typeof data === "string" ? data : JSON.stringify(data),
    );
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
}

function makeExpressResLike(onSend: (payload: CapturedResponse) => void) {
    const headers: Record<string, string> = {};
    // Circle's middleware uses Node `IncomingMessage`/`ServerResponse` style
    // (`res.statusCode = 402`, `res.end(body)`) — NOT Express
    // (`res.status().json()`). Both shapes are supported here so the adapter
    // bridges either flavor of caller.
    const res: Record<string, unknown> = {
        // Node-style: statusCode is a settable property.
        statusCode: 200,
        // Express-style alias.
        status(code: number) {
            (res as { statusCode: number }).statusCode = code;
            return res;
        },
        setHeader(k: string, v: string) {
            headers[k.toLowerCase()] = v;
            return res;
        },
        set(k: string, v: string) {
            headers[k.toLowerCase()] = v;
            return res;
        },
        getHeader(k: string) {
            return headers[k.toLowerCase()];
        },
        json(obj: unknown) {
            headers["content-type"] =
                headers["content-type"] ?? "application/json";
            const buf = new TextEncoder().encode(JSON.stringify(obj));
            const ab = new ArrayBuffer(buf.byteLength);
            new Uint8Array(ab).set(buf);
            onSend({
                status: (res as { statusCode: number }).statusCode,
                headers,
                body: ab,
            });
        },
        send(data: unknown) {
            onSend({
                status: (res as { statusCode: number }).statusCode,
                headers,
                body: toArrayBuffer(data),
            });
        },
        // Node-style: end() may receive a body argument.
        end(data?: unknown) {
            onSend({
                status: (res as { statusCode: number }).statusCode,
                headers,
                body: toArrayBuffer(data),
            });
        },
        // Node-style writeHead: writeHead(statusCode, headers?)
        writeHead(code: number, hdrs?: Record<string, string>) {
            (res as { statusCode: number }).statusCode = code;
            if (hdrs) {
                for (const [k, v] of Object.entries(hdrs)) {
                    headers[k.toLowerCase()] = v;
                }
            }
            return res;
        },
    };
    return res;
}

function stripPaymentHeaders(headers: Headers): Headers {
    const out = new Headers(headers);
    out.delete("payment-required");
    out.delete("payment-signature");
    out.delete("x-payment");
    return out;
}
