import { db } from "./db";
import type { Address } from "viem";

/**
 * Shared data loader for the ArkAge services catalog (Plan E3, theme D pivot).
 *
 * Aggregates every agent that has at least one active x402 endpoint plus
 * their on-chain anchor state, reputation summary, and tier-2 kind. Used by
 * both the public `/services` page (rich UI) and the `/api/services` JSON
 * feed (stable schema for external ingestion — eventual bridge to
 * agents.circle.com when Circle ships a listing API).
 */

export interface ServiceListing {
    /** ArkAge internal agent id (also the synthetic chain id for off-chain agents). */
    agentId: string;
    /** ERC-8004 IdentityRegistry token id; null when off-chain. */
    chainAgentId: string | null;
    /** Display name from latest metadata, or `Agent #<id>` fallback. */
    name: string;
    description: string | null;
    capabilities: string[];
    /** Tier 2 operator wallet (hex). */
    operator: Address;
    /** Tier 2 custody kind — `circle-agent-wallet` is the new recommendation. */
    custody: string;
    /** Hex tx hash of the IdentityRegistry.register call; null when off-chain. */
    identityRegisterTxHex: string | null;
    onChainRegisteredAt: string | null;
    active: boolean;
    endpoints: ServiceEndpoint[];
    reputation: {
        feedbackCount: number;
        averageScore: number | null;
    };
    /** Min / max price across all the agent's active endpoints, in raw USDC (6 decimals). */
    priceRange: { minRaw: string; maxRaw: string };
    /** Plan E.1 phase 1: dispute exposure surfaced in the catalog for at-a-glance trust signal. */
    disputes: { total: number; open: number };
}

export interface ServiceEndpoint {
    id: string;
    url: string;
    pricePerCallRaw: string;
    pricePerCallUsd: string;
    hosting: string;
    active: boolean;
}

const ZERO_RAW = "0";

/**
 * Returns the catalog sorted with on-chain-anchored agents first, then by
 * most recent feedback. Capped at `limit` (default 100) so the public page
 * and JSON feed stay cheap to render.
 */
export async function loadServiceCatalog(
    limit = 100,
): Promise<ServiceListing[]> {
    // Surface every active agent that's either (a) selling something via an
    // active x402 endpoint, or (b) anchored on-chain. The "anchored but no
    // endpoint" cohort is profile-only — they earn discovery via the
    // registry even before they list a service. Render handles both shapes.
    const agents = await db.agent.findMany({
        where: {
            active: true,
            OR: [
                { x402Endpoints: { some: { active: true } } },
                { chainAgentId: { not: null } },
            ],
        },
        include: {
            currentOperatorWallet: true,
            metadata: { orderBy: { createdAt: "desc" }, take: 1 },
            x402Endpoints: { where: { active: true } },
        },
        orderBy: [{ onChainRegisteredAt: "desc" }, { createdAt: "desc" }],
        take: limit,
    });

    // Fetch reputation summary in one shot to avoid N+1.
    const agentIds = agents.map((a) => a.id);
    const repRows =
        agentIds.length === 0
            ? []
            : await db.$queryRaw<
                  Array<{ agent_id: bigint; cnt: number; avg: number | null }>
              >`
                SELECT agent_id, COUNT(*)::int AS cnt, AVG(score)::float AS avg
                FROM reputation_feedback
                WHERE agent_id = ANY(${agentIds}::bigint[])
                GROUP BY agent_id
              `;
    const repByAgent = new Map<string, { cnt: number; avg: number | null }>();
    for (const row of repRows) {
        repByAgent.set(row.agent_id.toString(), {
            cnt: row.cnt,
            avg: row.avg,
        });
    }

    // Plan E.1 — dispute exposure rollup, also one query for the whole
    // catalog. Counts disputes where the agent is either the buyer or
    // seller on the underlying session.
    const disputeRows =
        agentIds.length === 0
            ? []
            : await db.$queryRaw<
                  Array<{
                      agent_id: bigint;
                      total: number;
                      open: number;
                  }>
              >`
                SELECT s.agent_id, COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE d.status = 'open')::int AS open
                FROM x402_disputes d
                JOIN x402_receipts r ON r.id = d.receipt_id
                JOIN (
                    SELECT id, buyer_agent_id AS agent_id FROM x402_sessions
                    UNION ALL
                    SELECT id, seller_agent_id AS agent_id FROM x402_sessions
                ) s ON s.id = r.session_id
                WHERE s.agent_id = ANY(${agentIds}::bigint[])
                GROUP BY s.agent_id
              `;
    const disputesByAgent = new Map<
        string,
        { total: number; open: number }
    >();
    for (const row of disputeRows) {
        disputesByAgent.set(row.agent_id.toString(), {
            total: row.total,
            open: row.open,
        });
    }

    return agents.map((a) => {
        const meta = a.metadata[0]?.metadataJsonb as
            | {
                  name?: string;
                  description?: string;
                  capabilities?: string[];
              }
            | undefined;

        const endpoints: ServiceEndpoint[] = a.x402Endpoints.map((e) => {
            const raw = e.pricePerCall.toString();
            return {
                id: e.id.toString(),
                url: e.effectiveUrl,
                pricePerCallRaw: raw,
                pricePerCallUsd: rawUsdcToUsd(raw),
                hosting: e.hosting,
                active: e.active,
            };
        });

        const prices = endpoints.map((e) => BigInt(e.pricePerCallRaw));
        const minPrice = prices.length
            ? prices.reduce((a, b) => (a < b ? a : b)).toString()
            : ZERO_RAW;
        const maxPrice = prices.length
            ? prices.reduce((a, b) => (a > b ? a : b)).toString()
            : ZERO_RAW;

        const rep = repByAgent.get(a.id.toString());
        const disputes = disputesByAgent.get(a.id.toString()) ?? {
            total: 0,
            open: 0,
        };

        return {
            agentId: a.agentId.toString(),
            chainAgentId: a.chainAgentId !== null ? a.chainAgentId.toString() : null,
            name: meta?.name ?? `Agent #${a.agentId.toString()}`,
            description: meta?.description ?? null,
            capabilities: meta?.capabilities ?? [],
            operator: ("0x" +
                Buffer.from(a.currentOperatorWallet.address).toString(
                    "hex",
                )) as Address,
            custody: a.currentOperatorWallet.custody,
            identityRegisterTxHex: a.identityRegisterTxHash
                ? "0x" + Buffer.from(a.identityRegisterTxHash).toString("hex")
                : null,
            onChainRegisteredAt: a.onChainRegisteredAt?.toISOString() ?? null,
            active: a.active,
            endpoints,
            reputation: {
                feedbackCount: rep?.cnt ?? 0,
                averageScore: rep?.avg ?? null,
            },
            priceRange: { minRaw: minPrice, maxRaw: maxPrice },
            disputes,
        };
    });
}

/** Format raw 6-decimal USDC into a "$0.001" style display string. */
export function rawUsdcToUsd(raw: string): string {
    const big = BigInt(raw);
    const whole = big / 1_000_000n;
    const fracStr =
        (big % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") ||
        "0";
    return `$${whole}.${fracStr}`;
}
