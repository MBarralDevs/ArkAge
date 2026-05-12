import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentBuilder } from "@/lib/auth-context";
import { hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";
import type { Address } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan E1 Task 9 — register a Circle Agent Wallet (SCA) as Tier 2 for the
 * signed-in builder, plus create the synthetic Agent + initial policy in
 * one round-trip (mirrors `scripts/smoke-register-circle-agent.ts` for the
 * console flow).
 *
 * Why not call the MCP `arkage:register_agent_wallet` tool? That tool only
 * touches the wallet row. The console UX wants a one-click "and also give
 * me an agent ready to use" — so we do the full agent + policy setup
 * server-side here. The MCP tool stays useful for agents-as-API callers.
 */

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ReqBody {
    address?: string;
    email?: string;
    backingEoa?: string;
    agentName?: string;
}

export async function POST(request: Request): Promise<Response> {
    const builder = await currentBuilder();
    if (!builder) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as ReqBody;
    if (
        !body.address ||
        !HEX_ADDRESS.test(body.address) ||
        !body.email ||
        !EMAIL.test(body.email) ||
        !body.backingEoa ||
        !HEX_ADDRESS.test(body.backingEoa)
    ) {
        return NextResponse.json(
            {
                error: "validation_error",
                message:
                    "address, email, and backingEoa are required and must be valid",
            },
            { status: 400 },
        );
    }

    const sca = body.address.toLowerCase() as Address;
    const scaBytes = Buffer.from(sca.slice(2), "hex");
    const backingEoaBytes = Buffer.from(
        body.backingEoa.toLowerCase().slice(2),
        "hex",
    );

    // Conflict check: refuse to claim a wallet that already belongs to a
    // different builder.
    const existing = await db.wallet.findUnique({ where: { address: scaBytes } });
    if (existing && existing.builderId !== builder.builderId) {
        return NextResponse.json(
            {
                error: "wallet_owned_by_other_builder",
                message: `address ${sca} is already registered to another builder`,
            },
            { status: 409 },
        );
    }

    const wallet = await db.wallet.upsert({
        where: { address: scaBytes },
        update: {
            tier: 2,
            custody: "circle-agent-wallet",
            accountType: "sca",
            builderId: builder.builderId,
            circleAgentWalletEmail: body.email,
            circleBackingEoa: backingEoaBytes,
            status: "active",
        },
        create: {
            address: scaBytes,
            tier: 2,
            custody: "circle-agent-wallet",
            accountType: "sca",
            builderId: builder.builderId,
            circleAgentWalletEmail: body.email,
            circleBackingEoa: backingEoaBytes,
            status: "active",
        },
    });

    const syntheticAgentId = `${998_000 + Number(wallet.id)}`;
    const agent = await db.agent.upsert({
        where: { agentId: syntheticAgentId },
        update: { currentOperatorWalletId: wallet.id, active: true },
        create: {
            agentId: syntheticAgentId,
            identityOwnerWallet: Buffer.from(
                builder.primaryWallet.replace(/^0x/, ""),
                "hex",
            ),
            currentOperatorWalletId: wallet.id,
            agentWalletAddress: scaBytes,
            registeredAtBlock: 0n,
            active: true,
        },
    });

    const existingPolicy = await db.policy.findFirst({
        where: { agentId: agent.id },
        orderBy: { version: "desc" },
    });
    if (!existingPolicy) {
        const nowSec = Math.floor(Date.now() / 1000);
        const policy: AgentPolicy = {
            schemaVersion: 1,
            agentId: agent.agentId.toString(),
            version: 1,
            validFrom: nowSec,
            validTo: null,
            spendCaps: {
                perTx: "10000000",
                perDay: "100000000",
                perWeek: "700000000",
            },
            allowedContracts: [],
            allowedSelectors: [],
            counterpartyRules: {
                minReputation: null,
                allowList: [],
                denyList: [],
            },
            rateLimits: { jobsPerHour: 100, x402CallsPerMinute: 100 },
            tokens: ["0x3600000000000000000000000000000000000000"],
            evaluatorPreferences: {
                defaultTier: "standard",
                maxFeePerJob: "1000000",
            },
        };
        const canonicalHash = hashPolicy(policy);
        const created = await db.policy.create({
            data: {
                agentId: agent.id,
                version: 1,
                bodyJsonb: policy as unknown as object,
                canonicalHash: Buffer.from(canonicalHash.replace(/^0x/, ""), "hex"),
                validFrom: new Date(),
                authoredByWallet: Buffer.from(
                    builder.primaryWallet.replace(/^0x/, ""),
                    "hex",
                ),
            },
        });
        await db.agent.update({
            where: { id: agent.id },
            data: { currentPolicyId: created.id },
        });
    }

    if (body.agentName) {
        await db.agentMetadata.create({
            data: {
                agentId: agent.id,
                metadataUri: `inline://agent/${agent.id}`,
                metadataJsonb: {
                    name: body.agentName,
                    description: "Registered via console — Circle Agent Wallet",
                    capabilities: [],
                    version: "1.0",
                } as object,
            },
        });
    }

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: builder.primaryWallet,
            action: "register_circle_agent_wallet",
            targetKind: "wallet",
            targetId: String(wallet.id),
            payloadJsonb: {
                sca,
                backingEoa: body.backingEoa,
                email: body.email,
            } as object,
        },
    });

    return NextResponse.json({
        ok: true,
        walletId: String(wallet.id),
        agentDbId: String(agent.id),
        agentChainId: agent.agentId.toString(),
        sca,
    });
}
