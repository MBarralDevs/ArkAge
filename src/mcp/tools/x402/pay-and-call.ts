import { z } from "zod";
import type { Address } from "viem";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { db } from "@/lib/db";
import { gatewayClientForAgent, payAndCall } from "@/lib/x402-buyer";
import { evaluatePolicy } from "@/lib/policy-engine";
import { loadAgentByDbId } from "@/lib/agent-loader";
import { route } from "@/lib/wallet-router";
import {
    openOrJoinSession,
    bumpSessionActivity,
} from "@/lib/x402-session-manager";
import { recordReceiptForSession } from "@/lib/x402-receipt-store";

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    url: z.string().url(),
    maxPrice: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
    expectedSeller: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional(),
    requestBody: z.unknown().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z.string().min(1),
});

interface Output {
    status: number;
    body: unknown;
    amountPaid: string;
    sellerAddress: string;
    receiptId: string;
    sessionId: string;
    facilitatorTxHash: string | null;
}

/**
 * arkage:pay_and_call — buyer-side x402 paid HTTP call.
 *
 * Flow:
 *   1. Off-chain policy gate (spend cap, deny list, rate limit)
 *   2. Wallet routing → must be Tier 2
 *   3. Resolve EOA private key for the agent's Tier 2 wallet
 *      (env-staged for v1 testnet; DCW signing bridge in v1.5)
 *   4. Call `payAndCall` which wraps `GatewayClient.pay()`
 *   5. If seller is an ArkAge-registered agent, open/join session
 *      and persist a receipt; otherwise the receipt is recorded
 *      against an unknown seller for buyer accounting only.
 */
export async function handlePayAndCall(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await loadAgentByDbId(BigInt(parse.data.asAgent));
    const maxPriceRaw = parse.data.maxPrice
        ? BigInt(parse.data.maxPrice)
        : undefined;

    const verdict = await evaluatePolicy({
        agentDbId: agent.dbId,
        policy: agent.policy,
        action: "x402_pay",
        ...(maxPriceRaw !== undefined && { amount: maxPriceRaw }),
        ...(parse.data.expectedSeller !== undefined && {
            counterparty: parse.data.expectedSeller as Address,
        }),
        contractTarget:
            "0x0000000000000000000000000000000000000000" as Address,
    });
    if (!verdict.ok) return err(verdict.code, verdict.message);

    const decision = route({
        kind: "x402_pay",
        agent: {
            agentId: agent.agentId,
            operatorWallet: agent.operatorWallet,
            perTxCap: agent.perTxCap,
            active: agent.active,
        },
    });
    if ("reject" in decision) {
        return err("routing_rejected", decision.reason);
    }
    if (decision.wallet !== "tier2-dcw") {
        return err(
            "routing_unexpected",
            `expected tier2-dcw, got ${decision.wallet}`,
        );
    }

    const wallet = await db.wallet.findUniqueOrThrow({
        where: {
            address: Buffer.from(
                agent.operatorWallet.replace(/^0x/, ""),
                "hex",
            ),
        },
    });

    // x402 signs via the env-staged raw EOA key (Plan D Task 1, LBC-1
    // testnet limitation). circleWalletId is irrelevant to this path —
    // it's only used by tools that route through Circle's DCW contract-
    // execution API. External-EOA Tier 2 wallets have circleWalletId=null
    // and that's fine.
    const eoaPrivateKey = process.env[`ARKAGE_TIER2_KEY_${wallet.id}`] as
        | `0x${string}`
        | undefined;
    if (!eoaPrivateKey) {
        return err(
            "config_error",
            "Tier 2 EOA key not provisioned in env (ARKAGE_TIER2_KEY_<walletId>)",
        );
    }

    const client = gatewayClientForAgent(eoaPrivateKey);

    let result;
    try {
        result = await payAndCall(client, {
            url: parse.data.url,
            ...(maxPriceRaw !== undefined && { maxPriceRaw }),
            ...(parse.data.expectedSeller !== undefined && {
                expectedSeller: parse.data.expectedSeller as Address,
            }),
            ...(parse.data.requestBody !== undefined && {
                requestBody: parse.data.requestBody,
            }),
            ...(parse.data.requestHeaders !== undefined && {
                requestHeaders: parse.data.requestHeaders,
            }),
        });
    } catch (e) {
        // SDK errors often wrap a useful `cause` (network errors, etc.).
        // Surface both in the audit log without including the full stack.
        const cause =
            e instanceof Error && (e as Error & { cause?: unknown }).cause
                ? String((e as Error & { cause?: unknown }).cause)
                : undefined;
        console.error(
            "[pay_and_call] SDK threw:",
            e instanceof Error ? e.message : String(e),
            cause ? `(cause: ${cause})` : "",
        );
        return err(
            "x402_pay_failed",
            e instanceof Error ? e.message : String(e),
        );
    }

    // Try to resolve seller agent + endpoint:
    //   1. If the URL points at our own arkage-proxy, parse endpointId
    //      from the path and look up its sellerAgent (covers the v1
    //      common case — external EOA buyers can't easily query their
    //      own SDK return for the seller address).
    //   2. Otherwise fall back to looking up sellerAddress
    //      (caller-supplied via expectedSeller) in our wallets table.
    let endpointDbId = 0n;
    let sellerAgentDbId: bigint = 0n;
    const proxyMatch = parse.data.url.match(
        /\/api\/x402-proxy\/(\d+)/,
    );
    if (proxyMatch && proxyMatch[1]) {
        const ep = await db.x402Endpoint.findUnique({
            where: { id: BigInt(proxyMatch[1]) },
        });
        if (ep) {
            endpointDbId = ep.id;
            sellerAgentDbId = ep.sellerAgentId;
        }
    }
    if (sellerAgentDbId === 0n && result.sellerAddress !== "0x") {
        const sellerWalletBytes = Buffer.from(
            result.sellerAddress.replace(/^0x/, ""),
            "hex",
        );
        const sellerWallet = await db.wallet.findUnique({
            where: { address: sellerWalletBytes },
        });
        if (sellerWallet) {
            const sa = await db.agent.findFirst({
                where: { currentOperatorWalletId: sellerWallet.id },
            });
            if (sa) sellerAgentDbId = sa.id;
        }
    }

    // Only persist a receipt when we have a valid endpoint row to
    // satisfy the x402_receipts → x402_endpoints FK. Sessions without
    // a registered endpoint still record the call as audit-only via
    // the workflow run.
    const canPersistReceipt = sellerAgentDbId > 0n && endpointDbId > 0n;
    const session =
        sellerAgentDbId > 0n
            ? await openOrJoinSession(agent.dbId, sellerAgentDbId)
            : null;

    const receipt = canPersistReceipt && session
        ? await recordReceiptForSession({
              sessionDbId: session.sessionDbId,
              endpointId: endpointDbId,
              amount: result.amountPaid,
              paymentSignature: result.paymentSignature,
              buyerWallet: agent.operatorWallet as Address,
              sellerWallet: result.sellerAddress,
              httpStatus: result.status,
          })
        : { receiptDbId: 0n, seq: 0 };

    if (session) await bumpSessionActivity(session.sessionDbId);

    return ok({
        status: result.status,
        body: result.body,
        amountPaid: result.amountPaid.toString(),
        sellerAddress: result.sellerAddress,
        receiptId: receipt.receiptDbId.toString(),
        sessionId: session?.sessionDbId.toString() ?? "0",
        facilitatorTxHash: result.facilitatorTxHash,
    });
}

registerTool({
    name: "arkage:pay_and_call",
    description:
        "Make an x402 paid HTTP call. Auto-opens or joins a session with the seller agent.",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            url: { type: "string" },
            maxPrice: { type: "string" },
            expectedSeller: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["asAgent", "url", "idempotencyKey"],
    },
    handler: handlePayAndCall,
});
