"use client";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function JobQuickActions({
    jobId,
    isBuyer,
}: {
    jobId: string;
    isBuyer: boolean;
}) {
    if (!isBuyer) return null;

    const onForce = async () => {
        const res = await fetch("/api/actions/force-advance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
        });
        if (res.ok) toast.success("Force-advance requested.");
        else toast.error("Force-advance failed.");
    };

    return (
        <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onForce}>
                Force advance
            </Button>
        </div>
    );
}
