import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<string, string> = {
    open: "bg-state-open/15 text-state-open border-state-open/30",
    funded: "bg-state-funded/15 text-state-funded border-state-funded/30",
    submitted:
        "bg-state-submitted/15 text-state-submitted border-state-submitted/30",
    completed:
        "bg-state-completed/15 text-state-completed border-state-completed/30",
    rejected: "bg-state-rejected/15 text-state-rejected border-state-rejected/30",
    expired: "bg-state-expired/15 text-state-expired border-state-expired/30",
};

export function JobStatusBadge({ status }: { status: string }) {
    const key = status.toLowerCase();
    const klass =
        STATUS_CLASSES[key] ?? "bg-muted text-muted-foreground border-border";
    return (
        <Badge
            variant="outline"
            className={cn("font-medium tabular-nums", klass)}
        >
            {status}
        </Badge>
    );
}
