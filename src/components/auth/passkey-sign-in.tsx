"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function PasskeySignIn() {
    const router = useRouter();
    const [wallet, setWallet] = useState("");
    const [busy, setBusy] = useState(false);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
            toast.error("Enter a valid wallet address");
            return;
        }
        setBusy(true);
        try {
            const challengeRes = await fetch("/api/auth/passkey/challenge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode: "authenticate",
                    builderWallet: wallet,
                }),
            });
            if (!challengeRes.ok) throw new Error("could not start auth");
            const options = await challengeRes.json();

            const credential = await startAuthentication({
                optionsJSON: options,
            });

            const signInRes = await fetch("/api/auth/sign-in", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    builderWallet: wallet,
                    response: credential,
                }),
            });
            if (!signInRes.ok) {
                const err = await signInRes.json().catch(() => ({}));
                throw new Error(err.error ?? "sign-in failed");
            }
            toast.success("Signed in");
            router.push("/console");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "sign-in failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="wallet">Builder wallet address</Label>
                <Input
                    id="wallet"
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value.trim())}
                    placeholder="0x…"
                    className="font-mono"
                    autoComplete="off"
                    required
                />
                <p className="text-xs text-muted-foreground">
                    The same wallet you used at{" "}
                    <code>arkage:bootstrap_user</code>. We&apos;ll prompt for
                    your passkey next.
                </p>
            </div>
            <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Authenticating…" : "Sign in with passkey"}
            </Button>
        </form>
    );
}
