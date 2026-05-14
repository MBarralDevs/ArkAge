"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CHAIN_ID, CHAIN_ID_HEX } from "@/lib/chain";

/**
 * Plan E2 Phase 3 — drives the two-tx on-chain anchoring flow from the
 * builder console using whatever injected wallet the builder has
 * (MetaMask / Rabby / Frame / etc.). No passkey signing yet; that's a
 * later layer.
 *
 * State machine:
 *   idle
 *     → fetching Tx 1 envelope (POST /api/actions/register-agent-onchain)
 *     → awaiting wallet broadcast of Tx 1
 *     → polling for Tx 1 receipt (POST /api/actions/confirm-onchain-mint)
 *     → awaiting wallet broadcast of Tx 2
 *     → polling for Tx 2 receipt (POST /api/actions/finalize-onchain-mint)
 *     → done (refresh + show "On-chain #<id>" badge)
 *
 * Each step shows a toast so the builder always knows what's happening.
 * Errors short-circuit with a descriptive toast and reset to idle so the
 * builder can retry (the MCP handlers are idempotent — re-running picks
 * up wherever we got stuck).
 */

type Phase =
    | "idle"
    | "fetching-tx1"
    | "awaiting-tx1"
    | "polling-tx1"
    | "fetching-tx2"
    | "awaiting-tx2"
    | "polling-tx2"
    | "done";

interface UnsignedTx {
    to: string;
    data: string;
    value: string;
}

interface ResultEnvelope<T> {
    ok: boolean;
    data?: T;
    code?: string;
    message?: string;
}

declare global {
    interface Window {
        ethereum?: {
            request: (args: {
                method: string;
                params?: unknown[] | Record<string, unknown>;
            }) => Promise<unknown>;
        };
    }
}

export function MintOnchainIdentityButton({
    agentDbId,
    builderWallet,
}: {
    agentDbId: string;
    builderWallet: string;
}) {
    const router = useRouter();
    const [phase, setPhase] = useState<Phase>("idle");

    const busy = phase !== "idle" && phase !== "done";

    async function ensureWalletAndChain(): Promise<string | null> {
        if (typeof window === "undefined" || !window.ethereum) {
            toast.error(
                "No injected wallet detected. Install MetaMask (or another EVM wallet) to anchor on-chain.",
            );
            return null;
        }
        try {
            const accounts = (await window.ethereum.request({
                method: "eth_requestAccounts",
            })) as string[];
            const connected = accounts[0]?.toLowerCase();
            if (!connected) {
                toast.error("No wallet account available.");
                return null;
            }
            if (connected !== builderWallet.toLowerCase()) {
                toast.error(
                    `Wrong account: wallet is ${shortAddress(connected)} but builder is ${shortAddress(builderWallet)}. Switch accounts and retry.`,
                );
                return null;
            }
            try {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: CHAIN_ID_HEX }],
                });
            } catch (e) {
                // chain not added — surface the error rather than auto-add
                // (avoids hard-coding RPC URLs in the client).
                toast.error(
                    `Switch to Arc Testnet (chain id ${CHAIN_ID}) in your wallet and retry. ` +
                        (e instanceof Error ? e.message : ""),
                );
                return null;
            }
            return connected;
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "wallet connection failed",
            );
            return null;
        }
    }

    async function broadcast(unsigned: UnsignedTx, from: string): Promise<string | null> {
        try {
            const txHash = (await window.ethereum!.request({
                method: "eth_sendTransaction",
                params: [
                    {
                        from,
                        to: unsigned.to,
                        data: unsigned.data,
                        value:
                            unsigned.value === "0"
                                ? "0x0"
                                : `0x${BigInt(unsigned.value).toString(16)}`,
                    },
                ],
            })) as string;
            return txHash;
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "transaction rejected",
            );
            return null;
        }
    }

    async function start() {
        const from = await ensureWalletAndChain();
        if (!from) return;

        setPhase("fetching-tx1");
        const env1 = await postJson<{
            state: "awaiting_tx1";
            pendingActions: Array<{ unsignedTx: UnsignedTx }>;
        }>("/api/actions/register-agent-onchain", { agentDbId });
        if (!env1.ok || !env1.data) {
            toast.error(env1.message ?? "could not encode Tx 1");
            setPhase("idle");
            return;
        }
        const tx1Envelope = env1.data.pendingActions[0]?.unsignedTx;
        if (!tx1Envelope) {
            toast.error("missing Tx 1 envelope");
            setPhase("idle");
            return;
        }

        setPhase("awaiting-tx1");
        toast.info("Approve the IdentityRegistry.register transaction in your wallet…");
        const tx1Hash = await broadcast(tx1Envelope, from);
        if (!tx1Hash) {
            setPhase("idle");
            return;
        }
        toast.success(`Tx 1 broadcast — ${shortHash(tx1Hash)}`);

        setPhase("polling-tx1");
        const tx2Envelope = await pollForTx2(tx1Hash);
        if (!tx2Envelope) {
            setPhase("idle");
            return;
        }
        toast.success(`Tx 1 mined — chain agent id ${tx2Envelope.chainAgentId}`);

        setPhase("awaiting-tx2");
        toast.info(
            "Approve the AgentRegistry.registerAgent transaction in your wallet…",
        );
        const tx2Hash = await broadcast(tx2Envelope.tx, from);
        if (!tx2Hash) {
            setPhase("idle");
            return;
        }
        toast.success(`Tx 2 broadcast — ${shortHash(tx2Hash)}`);

        setPhase("polling-tx2");
        const finalized = await pollForFinalize(tx2Hash);
        if (!finalized) {
            setPhase("idle");
            return;
        }

        setPhase("done");
        toast.success(`On-chain anchored as #${tx2Envelope.chainAgentId}`);
        router.refresh();
    }

    async function pollForTx2(
        tx1Hash: string,
    ): Promise<{ chainAgentId: string; tx: UnsignedTx } | null> {
        for (let attempt = 0; attempt < 24; attempt++) {
            const env = await postJson<{
                state: "tx1_pending" | "tx1_no_mint" | "awaiting_tx2";
                chainAgentId?: string;
                pendingActions?: Array<{ unsignedTx: UnsignedTx }>;
                reason?: string;
                retryAfter?: number;
            }>("/api/actions/confirm-onchain-mint", {
                agentDbId,
                identityRegisterTxHash: tx1Hash,
            });
            if (!env.ok || !env.data) {
                toast.error(env.message ?? "confirm step failed");
                return null;
            }
            if (env.data.state === "awaiting_tx2") {
                const tx = env.data.pendingActions?.[0]?.unsignedTx;
                if (!tx || !env.data.chainAgentId) {
                    toast.error("missing Tx 2 envelope");
                    return null;
                }
                return { chainAgentId: env.data.chainAgentId, tx };
            }
            if (env.data.state === "tx1_no_mint") {
                toast.error(env.data.reason ?? "Tx 1 didn't mint");
                return null;
            }
            await sleep((env.data.retryAfter ?? 5) * 1000);
        }
        toast.error("Timed out polling for Tx 1 receipt.");
        return null;
    }

    async function pollForFinalize(tx2Hash: string): Promise<boolean> {
        for (let attempt = 0; attempt < 24; attempt++) {
            const env = await postJson<{
                state: "tx2_pending" | "tx2_reverted" | "complete";
                reason?: string;
                retryAfter?: number;
            }>("/api/actions/finalize-onchain-mint", {
                agentDbId,
                agentRegistryTxHash: tx2Hash,
            });
            if (!env.ok || !env.data) {
                toast.error(env.message ?? "finalize step failed");
                return false;
            }
            if (env.data.state === "complete") return true;
            if (env.data.state === "tx2_reverted") {
                toast.error(env.data.reason ?? "Tx 2 reverted");
                return false;
            }
            await sleep((env.data.retryAfter ?? 5) * 1000);
        }
        toast.error("Timed out polling for Tx 2 receipt.");
        return false;
    }

    return (
        <Button onClick={start} disabled={busy} size="sm">
            {phaseLabel(phase)}
        </Button>
    );
}

function phaseLabel(p: Phase): string {
    switch (p) {
        case "idle":
            return "Mint on-chain identity";
        case "fetching-tx1":
            return "Preparing Tx 1…";
        case "awaiting-tx1":
            return "Approve Tx 1 in wallet…";
        case "polling-tx1":
            return "Waiting for Tx 1 to mine…";
        case "fetching-tx2":
            return "Preparing Tx 2…";
        case "awaiting-tx2":
            return "Approve Tx 2 in wallet…";
        case "polling-tx2":
            return "Waiting for Tx 2 to mine…";
        case "done":
            return "Anchored";
    }
}

async function postJson<T>(
    url: string,
    body: unknown,
): Promise<ResultEnvelope<T>> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = (await res.json()) as ResultEnvelope<T>;
        return data;
    } catch (e) {
        return {
            ok: false,
            message: e instanceof Error ? e.message : "network error",
        };
    }
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function shortAddress(a: string) {
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function shortHash(h: string) {
    return `${h.slice(0, 10)}…${h.slice(-6)}`;
}
