import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MoneyDisplay } from "@/components/primitives/money-display";

interface Row {
    agentId: string;
    receipts: number;
    revenue: string;
}

export function SellerLeaderboard({ rows }: { rows: Row[] }) {
    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r, i) => (
                        <TableRow key={r.agentId}>
                            <TableCell className="w-12 font-mono text-xs text-muted-foreground">
                                {i + 1}
                            </TableCell>
                            <TableCell className="font-mono">
                                <Link
                                    href={`/agents/${r.agentId}`}
                                    className="hover:underline"
                                >
                                    #{r.agentId}
                                </Link>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {r.receipts.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                                <MoneyDisplay raw={r.revenue} />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
