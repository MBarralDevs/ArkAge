import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface Row {
    runId: string;
    jobId: string;
    status: string;
    startedAt: string;
    lastAdvancedAt: string;
}

export function EvaluatorQueueTable({ rows }: { rows: Row[] }) {
    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Run</TableHead>
                        <TableHead>Job</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Last advanced</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.runId}>
                            <TableCell className="font-mono text-xs">
                                {r.runId.slice(0, 12)}…
                            </TableCell>
                            <TableCell className="font-mono">
                                <Link
                                    href={`/jobs/${r.jobId}`}
                                    className="hover:underline"
                                >
                                    #{r.jobId}
                                </Link>
                            </TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell className="text-xs">
                                {new Date(r.startedAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs">
                                {new Date(r.lastAdvancedAt).toLocaleString()}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
