import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";

export async function PolicyDecisionsPanel({ jobId }: { jobId: string }) {
    const rejections = await db.auditLog.findMany({
        where: {
            action: { startsWith: "policy:" },
            targetKind: "job",
            targetId: jobId,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Policy gate</CardTitle>
            </CardHeader>
            <CardContent>
                {rejections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No policy rejections recorded for this job.
                    </p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {rejections.map((r) => (
                            <li
                                key={r.id.toString()}
                                className="rounded-md border border-border/40 p-2 text-xs"
                            >
                                <span className="font-mono">{r.action}</span>
                                <span className="ml-2 text-muted-foreground">
                                    {new Date(r.createdAt).toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
