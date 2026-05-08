import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { Address } from "@/components/primitives/address";

interface Row {
    seq: number;
    amount: string;
    httpStatus: number | null;
    processedAt: string;
    buyerWallet: string;
    sellerWallet: string;
}

export function SessionReceiptTable({ rows }: { rows: Row[] }) {
    return (
        <div className="rounded-lg border border-border/40">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Seq</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Buyer</TableHead>
                        <TableHead>Seller</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Processed</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.seq}>
                            <TableCell className="font-mono">{r.seq}</TableCell>
                            <TableCell className="font-mono">
                                {r.httpStatus ?? "—"}
                            </TableCell>
                            <TableCell>
                                <Address value={r.buyerWallet} />
                            </TableCell>
                            <TableCell>
                                <Address value={r.sellerWallet} />
                            </TableCell>
                            <TableCell className="text-right">
                                <MoneyDisplay raw={r.amount} />
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                                {new Date(r.processedAt).toLocaleString()}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
