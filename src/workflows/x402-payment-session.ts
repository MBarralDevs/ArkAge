import { sleep, createHook } from "workflow";
import { db } from "@/lib/db";
import { x402SessionToken } from "./lib/hook-tokens";
import {
    recordWorkflowStart,
    recordWorkflowComplete,
} from "./lib/recording-steps";

/**
 * x402PaymentSession — durable lifecycle for a (buyer, seller) x402 session.
 *
 * Per LBC-2 Circle's hosted facilitator does the actual batched USDC
 * settlement; this workflow is the agent-aware overlay:
 *   - persists each receipt the facilitator forwards to us
 *   - runs an off-chain reputation gate every 10 receipts
 *   - closes on idle timeout (30 min) or an explicit `close` event
 *
 * Spawned by `arkage:open_x402_session` MCP tool. Receipts arrive via
 * the x402 facilitator webhook → `/api/webhooks/x402` → `resumeHook(token, …)`.
 *
 * The hook token is deterministic on (buyerAgentId, sellerAgentId) so the
 * webhook handler can reconstruct it without a side lookup.
 */

interface ReceiptEvent {
    kind: "receipt";
    receipt: {
        sessionDbId: string;
        endpointDbId: string;
        paymentSignature: string;
        amount: string;
        requestHash: string;
        responseHash?: string;
        httpStatus?: number;
        seq: number;
    };
}

interface CloseEvent {
    kind: "close";
    reason: "buyer_closed" | "idle_timeout";
}

type SessionEvent = ReceiptEvent | CloseEvent;

async function openSessionRow(
    buyer: bigint,
    seller: bigint,
    runId: string,
): Promise<bigint> {
    "use step";
    console.log(`[x402Session] openSessionRow buyer=${buyer} seller=${seller}`);
    const buyerAgent = await db.agent.findUniqueOrThrow({
        where: { agentId: buyer.toString() },
    });
    const sellerAgent = await db.agent.findUniqueOrThrow({
        where: { agentId: seller.toString() },
    });
    const now = new Date();
    const session = await db.x402Session.create({
        data: {
            buyerAgentId: buyerAgent.id,
            sellerAgentId: sellerAgent.id,
            workflowRunId: runId,
            status: "open",
            openedAt: now,
            lastActivityAt: now,
        },
    });
    console.log(
        `[x402Session] openSessionRow created sessionDbId=${session.id}`,
    );
    return session.id;
}

async function persistReceiptStep(receipt: ReceiptEvent["receipt"]): Promise<void> {
    "use step";
    console.log(
        `[x402Session] persistReceipt seq=${receipt.seq} amount=${receipt.amount}`,
    );
    await db.x402Receipt.create({
        data: {
            sessionId: BigInt(receipt.sessionDbId),
            endpointId: BigInt(receipt.endpointDbId),
            paymentKind: "gateway_batched",
            buyerWallet: Buffer.alloc(20),
            sellerWallet: Buffer.alloc(20),
            amount: receipt.amount,
            requestHash: Buffer.from(
                receipt.requestHash.replace(/^0x/, ""),
                "hex",
            ),
            responseHash: receipt.responseHash
                ? Buffer.from(receipt.responseHash.replace(/^0x/, ""), "hex")
                : null,
            paymentSignature: Buffer.from(
                receipt.paymentSignature.replace(/^0x/, ""),
                "hex",
            ),
            httpStatus: receipt.httpStatus ?? null,
            facilitatorProcessedAt: new Date(),
            seq: receipt.seq,
        },
    });
    await db.x402Session.update({
        where: { id: BigInt(receipt.sessionDbId) },
        data: {
            lastActivityAt: new Date(),
            totalCalls: { increment: 1 },
            totalAmount: { increment: receipt.amount },
        },
    });
}

async function checkSellerReputation(sellerAgentId: bigint): Promise<boolean> {
    "use step";
    console.log(`[x402Session] checkSellerReputation seller=${sellerAgentId}`);
    const sellerAgent = await db.agent.findUniqueOrThrow({
        where: { agentId: sellerAgentId.toString() },
    });
    if (!sellerAgent.active) return false;
    const fb = await db.reputationFeedback.findMany({
        where: { agentId: sellerAgent.id },
        select: { score: true },
    });
    if (fb.length === 0) return true;
    const avg = fb.reduce((s, r) => s + (r.score ?? 0), 0) / fb.length;
    return avg > -25;
}

async function closeSessionRow(
    sessionDbId: bigint,
    reason: string,
): Promise<void> {
    "use step";
    console.log(
        `[x402Session] closeSessionRow id=${sessionDbId} reason=${reason}`,
    );
    await db.x402Session.update({
        where: { id: sessionDbId },
        data: {
            status: reason === "risk_gated" ? "risk_gated" : "closed",
            closedAt: new Date(),
        },
    });
}

const IDLE_TIMEOUT_SEC = 30 * 60;
const SLEEP_SENTINEL = Symbol.for("x402Session:idleTimeout");

export async function x402PaymentSession(
    buyerAgentId: bigint,
    sellerAgentId: bigint,
) {
    "use workflow";

    await recordWorkflowStart("x402_session", buyerAgentId);
    const sessionDbId = await openSessionRow(buyerAgentId, sellerAgentId, "");

    let processed = 0;
    while (true) {
        // Re-create the hook each iteration: a Hook resolves once, so we
        // need a fresh awaitable for the next event. Token is deterministic
        // so the webhook handler keeps firing the same token regardless of
        // which iteration is currently waiting.
        const hook = createHook<SessionEvent>({
            token: x402SessionToken(buyerAgentId, sellerAgentId),
        });
        const winner = await Promise.race([
            Promise.resolve(hook),
            sleep(`${IDLE_TIMEOUT_SEC}s`).then(() => SLEEP_SENTINEL),
        ]);

        if (winner === SLEEP_SENTINEL) {
            hook.dispose();
            await closeSessionRow(sessionDbId, "idle_timeout");
            await recordWorkflowComplete("idle_timeout");
            return { outcome: "idle_timeout", processed };
        }

        const event = winner as SessionEvent;
        if (event.kind === "close") {
            await closeSessionRow(sessionDbId, event.reason);
            await recordWorkflowComplete(event.reason);
            return { outcome: event.reason, processed };
        }

        await persistReceiptStep(event.receipt);
        processed++;

        if (processed % 10 === 0) {
            const ok = await checkSellerReputation(sellerAgentId);
            if (!ok) {
                await closeSessionRow(sessionDbId, "risk_gated");
                await recordWorkflowComplete("risk_gated");
                return { outcome: "risk_gated", processed };
            }
        }
    }
}
