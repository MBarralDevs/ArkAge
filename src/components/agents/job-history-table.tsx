import Link from "next/link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
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

interface Row {
    jobId: string;
    status: string;
    budget: string | null;
    counterparty: string | null;
}

export function JobHistoryTable({
    asClient,
    asProvider,
}: {
    asClient: Row[];
    asProvider: Row[];
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Job history</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="provider">
                    <TabsList>
                        <TabsTrigger value="provider">
                            As provider ({asProvider.length})
                        </TabsTrigger>
                        <TabsTrigger value="client">
                            As client ({asClient.length})
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="provider">
                        <JobsTable
                            rows={asProvider}
                            counterpartyLabel="Client"
                        />
                    </TabsContent>
                    <TabsContent value="client">
                        <JobsTable
                            rows={asClient}
                            counterpartyLabel="Provider"
                        />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

function JobsTable({
    rows,
    counterpartyLabel,
}: {
    rows: Row[];
    counterpartyLabel: string;
}) {
    if (rows.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                No jobs yet.
            </p>
        );
    }
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>{counterpartyLabel}</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((r) => (
                    <TableRow key={r.jobId}>
                        <TableCell className="font-mono">
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
                            {r.counterparty ? (
                                <Link
                                    href={`/agents/${r.counterparty}`}
                                    className="hover:underline"
                                >
                                    #{r.counterparty}
                                </Link>
                            ) : (
                                "—"
                            )}
                        </TableCell>
                        <TableCell className="text-right">
                            <MoneyDisplay raw={r.budget} />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
