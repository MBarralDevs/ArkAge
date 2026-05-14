import { Badge } from "@/components/ui/badge";
import { txLink } from "@/lib/chain";

/**
 * Plan E2 — surfaces the agent's ERC-8004 on-chain anchor (token id on
 * IdentityRegistry) as a clickable badge that deep-links to Arcscan.
 *
 * When `chainAgentId` is null the agent is Postgres-only (not yet
 * anchored). Renders an outline "Draft (off-chain only)" badge so it
 * stays visually consistent — readers shouldn't have to wonder where the
 * on-chain id is.
 */
export function OnchainAnchorBadge({
    chainAgentId,
    identityTxHash,
    className,
}: {
    chainAgentId: bigint | null;
    /** Raw bytes of the IdentityRegistry.register tx hash. Null if not recorded yet. */
    identityTxHash?: Uint8Array | null;
    className?: string;
}) {
    if (chainAgentId === null || chainAgentId === undefined) {
        return (
            <Badge
                variant="outline"
                className={className}
                title="Postgres-only. Anyone can query this agent through ArkAge's API, but no on-chain anchor exists yet. The builder can opt into anchoring via the dashboard."
            >
                Draft (off-chain only)
            </Badge>
        );
    }
    const idStr = chainAgentId.toString();
    if (!identityTxHash) {
        return (
            <Badge
                className={className}
                title="ERC-8004 IdentityRegistry token id. Anyone can query this agent without going through ArkAge's API."
            >
                On-chain #{idStr}
            </Badge>
        );
    }
    const txHex =
        "0x" + Buffer.from(identityTxHash).toString("hex");
    return (
        <a
            href={txLink(txHex)}
            target="_blank"
            rel="noreferrer"
            className="no-underline"
        >
            <Badge
                className={className}
                title={`ERC-8004 IdentityRegistry token #${idStr}. Click to view the mint transaction on Arcscan.`}
            >
                On-chain #{idStr} ↗
            </Badge>
        </a>
    );
}
