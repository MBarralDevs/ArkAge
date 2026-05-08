import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    role: z.enum(["buyer", "seller", "both"]).default("both"),
    sinceMs: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(500).default(100),
});

interface ReceiptOutput {
    receiptId: string;
    sessionId: string;
    seq: number;
    amount: string;
    buyerWallet: string;
    sellerWallet: string;
    httpStatus: number | null;
    processedAt: string;
}

export async function handleListMyReceipts(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<{ receipts: ReceiptOutput[] }>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUniqueOrThrow({
        where: { agentId: parse.data.asAgent },
    });

    const sessionFilter: Record<string, unknown> = {};
    if (parse.data.role === "buyer") {
        sessionFilter.buyerAgentId = agent.id;
    } else if (parse.data.role === "seller") {
        sessionFilter.sellerAgentId = agent.id;
    } else {
        sessionFilter.OR = [
            { buyerAgentId: agent.id },
            { sellerAgentId: agent.id },
        ];
    }

    const sessions = await db.x402Session.findMany({
        where: sessionFilter,
        select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) return ok({ receipts: [] });

    const receipts = await db.x402Receipt.findMany({
        where: {
            sessionId: { in: sessionIds },
            ...(parse.data.sinceMs
                ? { createdAt: { gte: new Date(parse.data.sinceMs) } }
                : {}),
        },
        orderBy: { createdAt: "desc" },
        take: parse.data.limit,
    });

    return ok({
        receipts: receipts.map((r) => ({
            receiptId: r.id.toString(),
            sessionId: r.sessionId.toString(),
            seq: r.seq,
            amount: r.amount.toString(),
            buyerWallet: "0x" + Buffer.from(r.buyerWallet).toString("hex"),
            sellerWallet:
                "0x" + Buffer.from(r.sellerWallet).toString("hex"),
            httpStatus: r.httpStatus,
            processedAt: r.facilitatorProcessedAt.toISOString(),
        })),
    });
}

registerTool({
    name: "arkage:list_my_x402_receipts",
    description:
        "List receipts for an agent (as buyer, seller, or both)",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            role: {
                type: "string",
                enum: ["buyer", "seller", "both"],
            },
            sinceMs: { type: "number" },
            limit: { type: "number" },
        },
        required: ["asAgent"],
    },
    handler: handleListMyReceipts,
});
