"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    startAuthentication,
    startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Mode = "authenticate" | "register";

export function PasskeySignIn() {
    const router = useRouter();
    const [mode, setMode] = useState<Mode>("authenticate");
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
                body: JSON.stringify({ mode, builderWallet: wallet }),
            });
            if (!challengeRes.ok) {
                const err = await challengeRes.json().catch(() => ({}));
                throw new Error(err.error ?? "could not start passkey flow");
            }
            const options = await challengeRes.json();

            if (mode === "register") {
                const credential = await startRegistration({
                    optionsJSON: options,
                });
                const verifyRes = await fetch("/api/auth/passkey/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        mode: "register",
                        builderWallet: wallet,
                        response: credential,
                    }),
                });
                if (!verifyRes.ok) {
                    const err = await verifyRes.json().catch(() => ({}));
                    throw new Error(err.error ?? "passkey registration failed");
                }
                toast.success(
                    "Passkey registered — switch to Sign in to continue.",
                );
                setMode("authenticate");
                return;
            }

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
            toast.error(e instanceof Error ? e.message : "passkey flow failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex rounded-md border bg-muted/30 p-1">
                <button
                    type="button"
                    onClick={() => setMode("authenticate")}
                    className={`flex-1 rounded-sm px-3 py-1.5 text-sm transition-colors ${
                        mode === "authenticate"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Sign in
                </button>
                <button
                    type="button"
                    onClick={() => setMode("register")}
                    className={`flex-1 rounded-sm px-3 py-1.5 text-sm transition-colors ${
                        mode === "register"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Register passkey
                </button>
            </div>

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
                        {mode === "register"
                            ? "First time on this device? Register a passkey for your builder wallet. The builder row must already exist (from `npm run smoke:issue-token` or `arkage:bootstrap_user`)."
                            : "The same wallet you used at arkage:bootstrap_user. We'll prompt for your passkey next."}
                    </p>
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                    {busy
                        ? mode === "register"
                            ? "Registering…"
                            : "Authenticating…"
                        : mode === "register"
                          ? "Register passkey"
                          : "Sign in with passkey"}
                </Button>
            </form>
        </div>
    );
}
