import { NextResponse } from "next/server";
import { loadServiceCatalog } from "@/lib/services-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan E3 — machine-readable JSON feed of the ArkAge service catalog.
 * Stable schema below; bump `version` on breaking changes.
 *
 * Shape (excerpt):
 *   {
 *     "version": "1.0",
 *     "generatedAt": "ISO timestamp",
 *     "count": <int>,
 *     "services": [
 *       {
 *         "agentId": "<arkage internal id>",
 *         "chainAgentId": "<ERC-8004 token id>" | null,
 *         "name": "...",
 *         "description": "..." | null,
 *         "capabilities": [...],
 *         "operator": "0x...",
 *         "custody": "circle-agent-wallet" | "external-eoa" | "dcw" | ...,
 *         "onChainAnchor": null | {
 *           "tokenId": "<chainAgentId>",
 *           "identityRegistry": "0x8004A818...",
 *           "identityRegisterTxHash": "0x...",
 *           "registeredAt": "ISO"
 *         },
 *         "endpoints": [
 *           {
 *             "id": "...",
 *             "url": "https://...",
 *             "pricePerCallRaw": "<6-decimal raw>",
 *             "pricePerCallUsd": "$0.001",
 *             "hosting": "self" | "arkage-proxy",
 *             "active": true
 *           }
 *         ],
 *         "reputation": { "feedbackCount": <int>, "averageScore": <number> | null }
 *       }
 *     ]
 *   }
 *
 * Returned with 60-second public Cache-Control so polling clients (and
 * eventually agents.circle.com when Circle ships ingestion) don't hammer
 * the DB. Behind Vercel's edge cache this is effectively free.
 */

// Use the canonical address from src/lib/addresses.ts at runtime.
const IDENTITY_REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

export async function GET(): Promise<Response> {
    const services = await loadServiceCatalog(200);
    const body = {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        count: services.length,
        services: services.map((s) => ({
            agentId: s.agentId,
            chainAgentId: s.chainAgentId,
            name: s.name,
            description: s.description,
            capabilities: s.capabilities,
            operator: s.operator,
            custody: s.custody,
            onChainAnchor:
                s.chainAgentId !== null
                    ? {
                          tokenId: s.chainAgentId,
                          identityRegistry: IDENTITY_REGISTRY_ADDRESS,
                          identityRegisterTxHash: s.identityRegisterTxHex,
                          registeredAt: s.onChainRegisteredAt,
                      }
                    : null,
            endpoints: s.endpoints,
            reputation: s.reputation,
        })),
    };
    return NextResponse.json(body, {
        headers: {
            "cache-control": "public, max-age=60, s-maxage=60",
        },
    });
}
