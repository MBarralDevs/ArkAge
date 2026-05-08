"use client";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export function ReputationTimeseries({
    data,
}: {
    data: Array<{ ts: string; score: number }>;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Score over time</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient
                                    id="repFill"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop
                                        offset="0%"
                                        stopColor="hsl(var(--accent-ark))"
                                        stopOpacity={0.5}
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor="hsl(var(--accent-ark))"
                                        stopOpacity={0.0}
                                    />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="ts" tick={{ fontSize: 10 }} hide />
                            <YAxis
                                tick={{ fontSize: 10 }}
                                domain={[-100, 100]}
                            />
                            <Tooltip />
                            <Area
                                type="monotone"
                                dataKey="score"
                                stroke="hsl(var(--accent-ark))"
                                fill="url(#repFill)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
