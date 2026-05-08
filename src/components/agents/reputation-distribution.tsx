"use client";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Bar,
    BarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export function ReputationDistribution({
    data,
}: {
    data: Array<{ bucket: string; count: number }>;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Score distribution</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data}>
                            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                            <YAxis
                                allowDecimals={false}
                                tick={{ fontSize: 10 }}
                            />
                            <Tooltip
                                cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                            />
                            <Bar
                                dataKey="count"
                                fill="hsl(var(--accent-ark))"
                                radius={[4, 4, 0, 0]}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
