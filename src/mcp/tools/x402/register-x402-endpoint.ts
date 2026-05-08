import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

const Input = z.object({
    asAgent: z.string().regex(/^[0-9]+$/),
    url: z.string().url(),
    pricePerCall: z.string().regex(/^[0-9]+$/),
    hosting: z.enum(["self", "arkage-proxy"]),
    schema: z.unknown().optional(),
    idempotencyKey: z.string().min(1),
});

interface Output {
    endpointId: string;
    effectiveUrl: string;
}

export async function handleRegisterEndpoint(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) return err("validation_error", parse.error.message);

    const agent = await db.agent.findUniqueOrThrow({
        where: { agentId: parse.data.asAgent },
    });

    const created = await db.x402Endpoint.create({
        data: {
            sellerAgentId: agent.id,
            url: parse.data.url,
            effectiveUrl: parse.data.url, // overwritten below for proxy mode
            hosting: parse.data.hosting,
            pricePerCall: parse.data.pricePerCall,
            tokenAddress: Buffer.from(
                "3600000000000000000000000000000000000000",
                "hex",
            ),
            ...(parse.data.schema !== undefined && {
                schemaJsonb: parse.data.schema as object,
            }),
            active: true,
        },
    });

    let effectiveUrl = parse.data.url;
    if (parse.data.hosting === "arkage-proxy") {
        const base =
            process.env.ARKAGE_PROXY_BASE_URL ?? "https://arkage.network";
        effectiveUrl = `${base}/api/x402-proxy/${created.id}`;
        await db.x402Endpoint.update({
            where: { id: created.id },
            data: { effectiveUrl },
        });
    }

    return ok({ endpointId: created.id.toString(), effectiveUrl });
}

registerTool({
    name: "arkage:register_x402_endpoint",
    description:
        "Register an x402-priced endpoint for an agent. hosting='self' or 'arkage-proxy'.",
    inputSchema: {
        type: "object",
        properties: {
            asAgent: { type: "string" },
            url: { type: "string" },
            pricePerCall: { type: "string" },
            hosting: { type: "string", enum: ["self", "arkage-proxy"] },
            schema: {},
            idempotencyKey: { type: "string" },
        },
        required: [
            "asAgent",
            "url",
            "pricePerCall",
            "hosting",
            "idempotencyKey",
        ],
    },
    handler: handleRegisterEndpoint,
});
