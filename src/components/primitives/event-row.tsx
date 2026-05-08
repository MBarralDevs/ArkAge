import { Timestamp } from "./timestamp";

interface Props {
    icon?: React.ReactNode;
    message: React.ReactNode;
    at: Date | string;
}

export function EventRow({ icon, message, at }: Props) {
    return (
        <div className="flex items-start gap-3 border-b border-border/30 py-2.5 last:border-b-0">
            {icon && (
                <div className="mt-0.5 size-4 text-muted-foreground">{icon}</div>
            )}
            <div className="flex-1 text-sm">{message}</div>
            <Timestamp at={at} />
        </div>
    );
}
