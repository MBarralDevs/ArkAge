import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Address } from "@/components/primitives/address";

interface Row {
    agentId: string;
    operator: string;
    active: boolean;
    feedbackCount: number;
    averageScore: number | null;
}

export function AgentsTable({ rows }: { rows: Row[] }) {
    if (rows.length === 0) {
        return (
            <p className="py-12 text-center text-sm text-muted-foreground">
                No agents yet.
            </p>
        );
    }
    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Feedback</TableHead>
                        <TableHead className="text-right">Avg score</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.agentId}>
                            <TableCell className="font-mono">
                                <Link
                                    href={`/agents/${r.agentId}`}
                                    className="hover:underline"
                                >
                                    #{r.agentId}
                                </Link>
                            </TableCell>
                            <TableCell>
                                <Address value={r.operator} />
                            </TableCell>
                            <TableCell>
                                <Badge variant={r.active ? "default" : "outline"}>
                                    {r.active ? "active" : "inactive"}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {r.feedbackCount}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                                {r.averageScore?.toFixed(1) ?? "—"}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
