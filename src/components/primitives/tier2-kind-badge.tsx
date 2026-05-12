import { Badge } from "@/components/ui/badge";

/**
 * Visual badge for a wallet's `custody` value (Plan E1). Used on both the
 * builder console agent cards / profile and the public agent profile so
 * viewers can tell at a glance how an agent is custodied.
 */
export function Tier2KindBadge({
    custody,
    className,
}: {
    custody: string;
    className?: string;
}) {
    const config = mapCustody(custody);
    if (!config) return null;
    return (
        <Badge variant="outline" className={className} title={config.title}>
            {config.label}
        </Badge>
    );
}

function mapCustody(
    custody: string,
): { label: string; title: string } | null {
    switch (custody) {
        case "circle-agent-wallet":
            return {
                label: "Circle Agent Wallet",
                title: "MPC-backed SCA provisioned via Circle CLI. ArkAge holds no signing key.",
            };
        case "dcw":
            return {
                label: "Circle DCW EOA",
                title: "Circle Developer-Controlled Wallet in EOA mode (v1 default).",
            };
        case "external-eoa":
            return {
                label: "External EOA",
                title: "Bring-your-own EOA with env-staged private key (deprecated for new agents).",
            };
        case "modular":
            return {
                label: "Circle Modular",
                title: "Tier 1 builder wallet (passkey MSCA).",
            };
        case "system":
            return {
                label: "System",
                title: "ArkAge-internal wallet (Tier 3).",
            };
        default:
            return null;
    }
}
