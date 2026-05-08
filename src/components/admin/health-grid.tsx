import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

interface Stat {
    label: string;
    value: string;
    tone?: "ok" | "warn" | "alert";
}

const tones: Record<NonNullable<Stat["tone"]>, string> = {
    ok: "text-state-completed",
    warn: "text-state-submitted",
    alert: "text-state-rejected",
};

export function HealthGrid({ stats }: { stats: Stat[] }) {
    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {stats.map((s) => (
                <Card key={s.label}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                            {s.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p
                            className={
                                "text-2xl font-semibold tabular-nums " +
                                (s.tone ? tones[s.tone] : "")
                            }
                        >
                            {s.value}
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
