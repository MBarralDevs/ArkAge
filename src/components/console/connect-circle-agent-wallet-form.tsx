"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Success {
    ok: true;
    walletId: string;
    agentDbId: string;
    agentChainId: string;
    sca: `0x${string}`;
}

export function ConnectCircleAgentWalletForm() {
    const router = useRouter();
    const [address, setAddress] = useState("");
    const [email, setEmail] = useState("");
    const [backingEoa, setBackingEoa] = useState("");
    const [agentName, setAgentName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const validAddress = HEX_ADDRESS.test(address);
    const validBackingEoa = HEX_ADDRESS.test(backingEoa);
    const validEmail = EMAIL.test(email);
    const canSubmit =
        validAddress && validBackingEoa && validEmail && !submitting;

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const res = await fetch(
                "/api/actions/register-circle-agent-wallet",
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        address,
                        email,
                        backingEoa,
                        ...(agentName ? { agentName } : {}),
                    }),
                },
            );
            const data = (await res.json()) as Success | { error: string; message?: string };
            if (!res.ok || !("ok" in data) || !data.ok) {
                const msg =
                    "message" in data && data.message
                        ? data.message
                        : "error" in data
                          ? data.error
                          : "registration failed";
                toast.error(msg);
                return;
            }
            toast.success(
                `Registered as agent #${data.agentChainId} (db id ${data.agentDbId})`,
            );
            router.push("/console/agents");
            router.refresh();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "registration failed",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="sca">SCA address</Label>
                <Input
                    id="sca"
                    placeholder="0x86f9…"
                    value={address}
                    onChange={(e) => setAddress(e.target.value.trim())}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={address.length > 0 && !validAddress}
                />
                <p className="text-xs text-muted-foreground">
                    The Smart Contract Account address from{" "}
                    <code className="font-mono">circle wallet list</code>.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="backing-eoa">Backing EOA</Label>
                <Input
                    id="backing-eoa"
                    placeholder="0x3d63…"
                    value={backingEoa}
                    onChange={(e) => setBackingEoa(e.target.value.trim())}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={backingEoa.length > 0 && !validBackingEoa}
                />
                <p className="text-xs text-muted-foreground">
                    The <code className="font-mono">backingEOA</code> field
                    from <code className="font-mono">circle gateway balance</code>.
                    This is the MPC-controlled EOA that signs EIP-3009
                    authorizations on your SCA&rsquo;s behalf.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="email">Controlling email</Label>
                <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.trim())}
                    autoComplete="off"
                    aria-invalid={email.length > 0 && !validEmail}
                />
                <p className="text-xs text-muted-foreground">
                    The email you used for{" "}
                    <code className="font-mono">circle wallet login</code>.
                    Only visible to you in the console; never exposed publicly.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="agent-name">
                    Agent display name (optional)
                </Label>
                <Input
                    id="agent-name"
                    placeholder="my-research-agent"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    autoComplete="off"
                />
            </div>

            <Button type="submit" disabled={!canSubmit}>
                {submitting ? "Registering…" : "Register agent"}
            </Button>
        </form>
    );
}
