import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { Address } from "@/components/primitives/address";
import { VerifyEvidenceButton } from "./verify-evidence-button";

interface Props {
    evaluation: {
        model: string;
        tier: string;
        inputTokens: number | null;
        outputTokens: number | null;
        costUsd: string | null;
        verdict: string;
        score: number | null;
        reasoningText: string;
        evidenceUri: string;
        evidenceHash: string;
    } | null;
    evaluatorAddress: string;
    evaluatorFee: string | null;
    jobId: string;
}

export function EvaluatorPanel({
    evaluation,
    evaluatorAddress,
    evaluatorFee,
    jobId,
}: Props) {
    if (!evaluation) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Evaluator</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        No evaluation yet. Evaluator address:{" "}
                        <Address value={evaluatorAddress} />
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Evaluator decision</CardTitle>
                <Badge
                    variant={
                        evaluation.verdict === "accept"
                            ? "default"
                            : "destructive"
                    }
                >
                    {evaluation.verdict}
                </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                    <div>
                        <dt className="text-muted-foreground">Model</dt>
                        <dd className="font-mono">{evaluation.model}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Tier</dt>
                        <dd className="capitalize">{evaluation.tier}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Score</dt>
                        <dd className="font-mono tabular-nums">
                            {evaluation.score ?? "—"}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Fee</dt>
                        <dd>
                            <MoneyDisplay raw={evaluatorFee} />
                        </dd>
                    </div>
                </dl>
                <div className="rounded-md border border-border/40 bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {evaluation.reasoningText}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                        Evidence hash{" "}
                        <code className="font-mono">
                            {evaluation.evidenceHash.slice(0, 14)}…
                        </code>
                    </p>
                    <VerifyEvidenceButton jobId={jobId} />
                </div>
            </CardContent>
        </Card>
    );
}
