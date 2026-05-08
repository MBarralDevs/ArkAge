"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
    const router = useRouter();
    const onClick = async () => {
        await fetch("/api/auth/sign-out", { method: "POST" });
        router.push("/");
        router.refresh();
    };
    return (
        <Button variant="outline" size="sm" onClick={onClick}>
            Sign out
        </Button>
    );
}
