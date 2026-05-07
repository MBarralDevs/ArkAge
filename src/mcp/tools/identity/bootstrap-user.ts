import { z } from "zod";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { ok, err, type Result } from "@/mcp/result";
import { registerTool } from "@/mcp/server";
import type { McpAuthContext } from "@/mcp/auth";
import { provisionTier2DcwForBuilder } from "@/lib/tier2-dcw";
import { hashPolicy, type AgentPolicy } from "@/lib/policy-canonical";
import { registerTier1Wallet, type PendingTier1Signature } from "@/lib/tier1-modular";
import { ARC_TESTNET_ADDRESSES } from "@/lib/addresses";

/**
 * arkage:bootstrap_user — the entry point a brand-new builder hits to
 * become an active ArkAge participant.
 *
 * Per spec §3.3, this tool is the deepest in the identity domain. It:
 *  1. Upserts a Builder row keyed by primaryWallet
 *  2. Records the Tier 1 modular-wallet address (server-side bookkeeping;
 *     the WebAuthn ceremony itself ships in Plan C dashboard)
 *  3. Provisions a fresh Tier 2 DCW EOA on Arc Testnet for the agent
 *  4. Generates a default policy + canonical hash
 *  5. Returns pendingActions[] describing the Tier 1 signatures the
 *     dashboard needs to collect to complete the on-chain mint
 *     (ERC-8004 register + AgentRegistry.registerAgent)
 *
 * The on-chain side is finished by the dashboard, not by this tool —
 * this tool's job is to set up off-chain state and produce the unsigned
 * tx envelopes the human signs via passkey.
 */

const Input = z.object({
    mode: z.enum(["passkey-builder+dcw-agent", "dcw-only", "passkey-only"]),
    agentMetadata: z.object({
        name: z.string().min(1),
        description: z.string(),
        capabilities: z.array(z.string()),
        version: z.string(),
    }),
    builderPrimaryWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    displayName: z.string().optional(),
    initialPolicy: z.unknown().optional(),
    evaluatorTier: z.enum(["fast", "standard", "premium"]).default("standard"),
    idempotencyKey: z.string().min(1),
});

type BootstrapInput = z.infer<typeof Input>;

interface BootstrapOutput {
    builderId: string;
    builderWalletAddress: Address;
    agentIdentityId: string | null;
    agentOperatorWallet: Address;
    policyVersion: number;
    policyHash: `0x${string}`;
    pendingActions: PendingTier1Signature[];
}

function defaultPolicy(
    agentIdPlaceholder: string,
    evaluatorTier: BootstrapInput["evaluatorTier"],
): AgentPolicy {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        schemaVersion: 1,
        agentId: agentIdPlaceholder,
        version: 1,
        validFrom: nowSec,
        validTo: null,
        spendCaps: { perTx: "1000000", perDay: "10000000", perWeek: "70000000" },
        allowedContracts: [],
        allowedSelectors: [],
        counterpartyRules: { minReputation: null, allowList: [], denyList: [] },
        rateLimits: { jobsPerHour: 10, x402CallsPerMinute: 60 },
        tokens: ["0x3600000000000000000000000000000000000000"],
        evaluatorPreferences: {
            defaultTier: evaluatorTier,
            maxFeePerJob: "5000000",
        },
    };
}

export async function handleBootstrapUser(
    rawInput: unknown,
    _ctx: McpAuthContext,
): Promise<Result<BootstrapOutput>> {
    const parse = Input.safeParse(rawInput);
    if (!parse.success) {
        return err("validation_error", parse.error.message);
    }
    const input = parse.data;

    const builderWallet = Buffer.from(
        input.builderPrimaryWallet.toLowerCase().replace(/^0x/, ""),
        "hex",
    );

    // Upsert Builder. The primaryWallet uniqueness ensures idempotency
    // across retries with the same wallet address.
    const builder = await db.builder.upsert({
        where: { primaryWallet: builderWallet },
        update: input.displayName !== undefined ? { displayName: input.displayName } : {},
        create: {
            primaryWallet: builderWallet,
            displayName: input.displayName ?? null,
        },
    });

    // Tier 1 (modular) is recorded for every mode except dcw-only.
    if (input.mode !== "dcw-only") {
        // Idempotency: Wallet has unique(address); skip duplicate inserts.
        const existing = await db.wallet.findUnique({
            where: { address: builderWallet },
        });
        if (!existing) {
            await registerTier1Wallet({
                builderId: builder.id,
                address: input.builderPrimaryWallet as Address,
            });
        }
    }

    const tier2 = await provisionTier2DcwForBuilder(builder.id);

    const policy = defaultPolicy(`pending:${builder.id}`, input.evaluatorTier);
    const policyHash = hashPolicy(policy);

    await db.auditLog.create({
        data: {
            actorKind: "builder",
            actorId: input.builderPrimaryWallet,
            action: "bootstrap_user",
            payloadJsonb: {
                mode: input.mode,
                idempotencyKey: input.idempotencyKey,
                evaluatorTier: input.evaluatorTier,
            } as object,
        },
    });

    const pendingActions: PendingTier1Signature[] = [];
    if (input.mode !== "dcw-only") {
        // Two Tier 1 signatures are still owed:
        //   (a) ERC-8004 IdentityRegistry.register(metadataURI) — mints the
        //       identity NFT to the builder's Tier 1 wallet
        //   (b) AgentRegistry.registerAgent(agentId, operator, ...)  — binds
        //       the freshly-minted identity to the Tier 2 operator wallet
        // The dashboard collects both via passkey, broadcasts in order, and
        // calls back into Plan B's identity_completion tool to update the
        // agent_identity_id once the mint event is observed onchain.
        pendingActions.push({
            kind: "tier1_signature_required",
            reason: "identity_op",
            unsignedTx: {
                to: ARC_TESTNET_ADDRESSES.ERC_8004_IDENTITY_REGISTRY,
                data: "0x",
                value: "0",
            },
        });
    }

    return ok({
        builderId: String(builder.id),
        builderWalletAddress: input.builderPrimaryWallet as Address,
        agentIdentityId: null,
        agentOperatorWallet: tier2.address,
        policyVersion: policy.version,
        policyHash,
        pendingActions,
    });
}

registerTool({
    name: "arkage:bootstrap_user",
    description:
        "Provision a builder + agent (Tier 1 + Tier 2 wallets), default policy, return identity-op intents the dashboard signs",
    inputSchema: {
        type: "object",
        properties: {
            mode: {
                type: "string",
                enum: ["passkey-builder+dcw-agent", "dcw-only", "passkey-only"],
            },
            builderPrimaryWallet: { type: "string" },
            displayName: { type: "string" },
            evaluatorTier: { type: "string", enum: ["fast", "standard", "premium"] },
            idempotencyKey: { type: "string" },
            agentMetadata: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    capabilities: { type: "array" },
                    version: { type: "string" },
                },
            },
        },
        required: ["mode", "builderPrimaryWallet", "agentMetadata", "idempotencyKey"],
    },
    handler: handleBootstrapUser,
});
