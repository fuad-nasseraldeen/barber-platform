"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StaffPerformanceChartProps {
  data: Array<{
    staffId: string;
    staffName: string;
    totalBookings: number;
    completedBookings: number;
    revenue: number;
    completionRate: number;
  }>;
}

export function StaffPerformanceChart({ data }: StaffPerformanceChartProps) {
  const chartData = [...data]
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5)
    .map((s) => ({
      name: s.staffName,
      shortName: s.staffName.length > 14 ? s.staffName.slice(0, 12) + "…" : s.staffName,
      completionRate: s.completionRate,
      revenue: s.revenue,
    }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:scale-[1.01] hover:shadow-xl dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <h2 className="mb-4 font-semibold">Staff Performance</h2>
      {chartData.length ? (
        <div className="h-56 min-h-[224px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="shortName" width={90} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ padding: "8px 12px", borderRadius: 8 }}
                formatter={(value: unknown) => [value != null ? `${Number(value).toFixed(0)}%` : "", "Completion rate"]}
                labelFormatter={(_, payload) => (payload?.[0]?.payload?.name as string) ?? ""}
              />
              <Bar dataKey="completionRate" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} name="Completion" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-zinc-500">No data</p>
      )}
    </div>
  );
}
