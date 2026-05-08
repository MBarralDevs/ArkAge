"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ScoreDistribution({ data }: { data: Array<{ bucket: string; count: number }> }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Protocol-wide score distribution</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-72 w-full">
                    <ResponsiveContainer>
                        <BarChart data={data}>
                            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                            <Bar dataKey="count" fill="hsl(var(--accent-ark))" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
