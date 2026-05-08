import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/primitives/money-display";
import { db } from "@/lib/db";

async function load() {
    const movements = await db.treasuryMovement.findMany({
        select: { direction: true, amount: true },
    });
    const inSum = movements
        .filter((m) => m.direction === "in")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
    const outSum = movements
        .filter((m) => m.direction === "out")
        .reduce((s, m) => s + BigInt(m.amount.toString()), 0n);
    return { inSum, outSum, net: inSum - outSum };
}

export async function TreasuryWidget() {
    const { inSum, outSum, net } = await load();
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Treasury</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-sm">
                <div>
                    <p className="text-xs text-muted-foreground">Fees in</p>
                    <MoneyDisplay
                        raw={inSum}
                        className="text-base font-semibold"
                    />
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Out</p>
                    <MoneyDisplay
                        raw={outSum}
                        className="text-base font-semibold"
                    />
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Net</p>
                    <MoneyDisplay
                        raw={net}
                        className="text-base font-semibold"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
