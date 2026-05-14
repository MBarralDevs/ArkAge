import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Layout's Header is async and calls cookies() via currentBuilder, which
// makes static prerender of this otherwise-static page fail. Force-dynamic
// matches the rest of the app and aligns with the auth-aware header pattern.
export const dynamic = "force-dynamic";

export default function SecurityPage() {
    return (
        <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
            <header className="space-y-2">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    ── Custody disclosure ─ what we cannot do ──
                </p>
                <h1 className="font-mono text-3xl font-bold leading-tight text-foreground md:text-4xl">
                    Security &amp; custody
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    ArkAge is open about what we do, do not, and cannot do
                    with your funds and identity. This page is the canonical
                    disclosure of the custody model in v1.
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Three wallet tiers per builder
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <div>
                        <Badge variant="outline">Tier 1 — non-custodial</Badge>
                        <p className="mt-1">
                            Your <strong>Circle Modular Wallet</strong>,
                            anchored to a passkey on your device. Owns your
                            ERC-8004 identity NFTs and signs all high-value or
                            governance actions (revoke an agent, update a
                            policy, transfer identity, recover via mnemonic).
                            <strong className="ml-1 text-foreground">
                                ArkAge cannot sign on your behalf.
                            </strong>
                            Lose the passkey + lose the recovery mnemonic = lose
                            access. Standard Web3 risk.
                        </p>
                    </div>
                    <div>
                        <Badge variant="outline">
                            Tier 2 — custodial within policy
                        </Badge>
                        <p className="mt-1">
                            Your agent's{" "}
                            <strong>
                                Circle Developer-Controlled Wallet (EOA mode)
                            </strong>
                            . ArkAge holds these keys via Circle's entity
                            secret, but every signing call is gated by the
                            policy you set in Tier 1. Hard caps: per-tx amount,
                            allowed contracts, denied counterparties, agent
                            active flag — all enforced both off-chain in our MCP
                            server and on-chain in the PolicyHook contract.
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Worst-case if our entity secret leaks: an attacker
                            can drain Tier 2 wallets up to your per-tx cap, only
                            against allowlisted contracts, until you revoke from
                            Tier 1. Per-builder maximum loss = perTxCap × active
                            agents.
                        </p>
                    </div>
                    <div>
                        <Badge variant="outline">
                            Tier 3 — ArkAge system wallets
                        </Badge>
                        <p className="mt-1">
                            Three ArkAge-controlled wallets: validator (signs
                            evaluator decisions), treasury (collects fees),
                            gas-funder (one-time deposits during bootstrap).
                            Each rotated independently. Compromise impact is
                            bounded to ArkAge's own attestations and revenue,
                            not user funds.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        What we always do
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                    <p>
                        · Enforce policy twice — off-chain (fast UX rejection)
                        and on-chain (trust boundary).
                    </p>
                    <p>
                        · Hash evaluator evidence on-chain so anyone can
                        verify-by-hash from the dashboard.
                    </p>
                    <p>
                        · Surface stuck-job counts publicly. Failure modes are
                        visible, not hidden.
                    </p>
                    <p>
                        · Honor revocation as a single-tx kill-switch from
                        Tier 1.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        v1.5 / v2 roadmap
                    </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                    The Tier 2 custody trade is a deliberate v1 simplification.
                    ERC-7710 session keys (currently Draft EIP) replace it with
                    non-custodial scoped delegations from your Tier 1 Modular
                    wallet. Migration is the headline v1.5 milestone.
                </CardContent>
            </Card>
        </div>
    );
}
