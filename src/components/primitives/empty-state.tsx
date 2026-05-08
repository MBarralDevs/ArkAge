interface Props {
    title: string;
    description?: string;
    action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/30 p-12 text-center">
            <p className="font-medium">{title}</p>
            {description && (
                <p className="max-w-md text-sm text-muted-foreground">
                    {description}
                </p>
            )}
            {action}
        </div>
    );
}
