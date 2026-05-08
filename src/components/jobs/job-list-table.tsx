import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { JobStatusBadge } from "@/components/primitives/job-status-badge";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { Timestamp } from "@/components/primitives/timestamp";

interface Row {
    jobId: string;
    status: string;
    budget: string | null;
    expiredAt: string;
    createdAt: string;
    clientAgentId: string | null;
    providerAgentId: string | null;
}

export function JobListTable({ rows }: { rows: Row[] }) {
    if (rows.length === 0) {
        return (
            <p className="py-12 text-center text-sm text-muted-foreground">
                No jobs match these filters.
            </p>
        );
    }

    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Job</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Budget</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                        <TableHead className="text-right">Expires</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.jobId}>
                            <TableCell className="font-mono text-sm">
                                <Link
                                    href={`/jobs/${r.jobId}`}
                                    className="hover:underline"
                                >
                                    #{r.jobId}
                                </Link>
                            </TableCell>
                            <TableCell>
                                <JobStatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                                {r.clientAgentId ? (
                                    <Link
                                        href={`/agents/${r.clientAgentId}`}
                                        className="hover:underline"
                                    >
                                        #{r.clientAgentId}
                                    </Link>
                                ) : (
                                    "—"
                                )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                                {r.providerAgentId ? (
                                    <Link
                                        href={`/agents/${r.providerAgentId}`}
                                        className="hover:underline"
                                    >
                                        #{r.providerAgentId}
                                    </Link>
                                ) : (
                                    "—"
                                )}
                            </TableCell>
                            <TableCell>
                                <MoneyDisplay raw={r.budget} />
                            </TableCell>
                            <TableCell className="text-right">
                                <Timestamp at={r.createdAt} />
                            </TableCell>
                            <TableCell className="text-right">
                                <Timestamp at={r.expiredAt} />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
