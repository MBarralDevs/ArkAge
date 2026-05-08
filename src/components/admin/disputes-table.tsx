import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Row {
    id: string;
    receiptId: string;
    status: string;
    reason: string;
    createdAt: string;
    resolvedAt: string | null;
}

export function DisputesTable({ rows }: { rows: Row[] }) {
    if (rows.length === 0) {
        return (
            <p className="py-12 text-center text-sm text-muted-foreground">
                No disputes.
            </p>
        );
    }
    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Dispute</TableHead>
                        <TableHead>Receipt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Opened</TableHead>
                        <TableHead>Resolved</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.id}>
                            <TableCell className="font-mono">
                                #{r.id}
                            </TableCell>
                            <TableCell className="font-mono">
                                #{r.receiptId}
                            </TableCell>
                            <TableCell>
                                <Badge
                                    variant={
                                        r.status === "manual_review"
                                            ? "destructive"
                                            : "outline"
                                    }
                                >
                                    {r.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="max-w-md truncate text-xs">
                                {r.reason}
                            </TableCell>
                            <TableCell className="text-xs">
                                {new Date(r.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs">
                                {r.resolvedAt
                                    ? new Date(r.resolvedAt).toLocaleString()
                                    : "—"}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
