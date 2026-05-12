import { z } from "zod";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";

/**
 * arkage:register_agent_wallet — Plan E1 Task 5.
 *
 * Lightweight registration entry point for adding a Tier 2 wallet that is
 * **externally managed** (i.e. ArkAge does not provision or hold a session
 * for it). Today this means a Circle Agent Wallet whose CLI session lives
 * on the builder's machine; in the future, other externally-managed kinds
 * can slot in here too (`external-eoa` is also supported for parity).
 *
 * Distinct from `arkage:bootstrap_user`, which provisions a Tier 1 modular
 * wallet + a Circle DCW EOA in one go. This tool assumes the builder
 * already exists and just want to wire a pre-existing wallet address to
 * their builder identity as a registered Tier 2.
 *
 * Why this matters:
 *  - Drops the `ARKAGE_TIER2_KEY_<walletId>` env-staged-key path. ArkAge
 *    never holds the signing key for `circle-agent-wallet` kinds.
 *  - Records the backing EOA and controlling email so the dashboard can
 *    show the right metadata + downstream code can resolve EIP-3009 `from`
 *    addresses back to the SCA identity (see runbook for SCA vs backing
 *    EOA explanation).
 */

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Input = z
    .object({
        kind: z.enum(["circle-agent-wallet", "external-eoa"]),
        address: z.string().regex(HEX_ADDRESS),
        circleAgentWalletEmail: z.string().regex(EMAIL).optional(),
        circleBackingEoa: z.string().regex(HEX_ADDRESS).optional(),
        idempotencyKey: z.string().min(1),
    })
    .superRefine((val, ctx) => {
        if (val.kind === "circle-agent-wallet") {
            if (!val.circleAgentWalletEmail) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["circleAgentWalletEmail"],
                    message:
                        "circleAgentWalletEmail is required when kind=circle-agent-wallet",
                });
            }
            if (!val.circleBackingEoa) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["circleBackingEoa"],
                    message:
                        "circleBackingEoa is required when kind=circle-agent-wallet",
                });
            }
        }
    });

interface Output {
    walletId: string;
    address: Address;
    kind: "circle-agent-wallet" | "external-eoa";
    builderId: string;
}

export async function handleRegisterAgentWallet(
    rawInput: unknown,
    ctx: McpAuthContext,
): Promise<Result<Output>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) {
        return err("validation_error", parse.error.message);
    }
    const input = parse.data;

    const addressBytes = Buffer.from(
        input.address.toLowerCase().replace(/^0x/, ""),
        "hex",
    );

    // Idempotency: a wallet with this address may already exist (from a prior
    // retry, or from another flow). We treat that as success only if it is
    // already owned by the same builder; otherwise it is a conflict.
    const existing = await db.wallet.findUnique({
        where: { address: addressBytes },
    });
    if (existing) {
        if (existing.builderId !== ctx.builderId) {
            return err(
                "wallet_owned_by_other_builder",
                `address ${input.address} is already registered to another builder`,
            );
        }
        return ok({
            walletId: String(existing.id),
            address: input.address as Address,
            kind: input.kind,
            builderId: String(ctx.builderId),
        });
    }

    const accountType = input.kind === "circle-agent-wallet" ? "sca" : "eoa";

    const created = await db.wallet.create({
        data: {
            address: addressBytes,
            tier: 2,
            custody: input.kind,
            accountType,
            builderId: ctx.builderId,
            circleAgentWalletEmail: input.circleAgentWalletEmail ?? null,
            circleBackingEoa:
                input.circleBackingEoa !== undefined
                    ? Buffer.from(
                          input.circleBackingEoa.toLowerCase().replace(/^0x/, ""),
                          "hex",
                      )
                    : null,
        },
    });

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: ctx.actingWalletAddress,
            action: "register_agent_wallet",
            targetKind: "wallet",
            targetId: String(created.id),
            payloadJsonb: {
                kind: input.kind,
                address: input.address,
                idempotencyKey: input.idempotencyKey,
                ...(input.kind === "circle-agent-wallet"
                    ? {
                          email: input.circleAgentWalletEmail,
                          backingEoa: input.circleBackingEoa,
                      }
                    : {}),
            } as object,
        },
    });

    return ok({
        walletId: String(created.id),
        address: input.address as Address,
        kind: input.kind,
        builderId: String(ctx.builderId),
    });
}

registerTool({
    name: "arkage:register_agent_wallet",
    description:
        "Register an externally-managed Tier 2 wallet (Circle Agent Wallet or external EOA) to the calling builder",
    inputSchema: {
        type: "object",
        properties: {
            kind: {
                type: "string",
                enum: ["circle-agent-wallet", "external-eoa"],
            },
            address: { type: "string" },
            circleAgentWalletEmail: { type: "string" },
            circleBackingEoa: { type: "string" },
            idempotencyKey: { type: "string" },
        },
        required: ["kind", "address", "idempotencyKey"],
    },
    handler: handleRegisterAgentWallet,
});
