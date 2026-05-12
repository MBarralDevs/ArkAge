"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function CopyableCommand({
    label,
    command,
}: {
    label: string;
    command: string;
}) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard write can fail in non-secure contexts; silently no-op.
        }
    }

    return (
        <div className="space-y-1">
            {label ? (
                <Label className="text-xs text-muted-foreground">{label}</Label>
            ) : null}
            <div className="flex items-stretch gap-2">
                <pre className="flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                    {command}
                </pre>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copy}
                    aria-label="Copy command"
                >
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
        </div>
    );
}
