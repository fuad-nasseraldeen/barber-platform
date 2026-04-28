"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type TimeFilter = "day" | "week" | "month";

interface AppointmentsTrendChartProps {
  data: { date: string; count: number }[];
  timeFilter: TimeFilter;
  onTimeFilterChange?: (filter: TimeFilter) => void;
}

function sliceByFilter(
  data: { date: string; count: number }[],
  filter: TimeFilter
): { date: string; count: number }[] {
  const d = [...data];
  switch (filter) {
    case "day":
      return d.slice(-7);
    case "week":
      return d.slice(-14);
    case "month":
      return d.slice(-30);
    default:
      return d.slice(-14);
  }
}

export function AppointmentsTrendChart({
  data,
  timeFilter,
  onTimeFilterChange,
}: AppointmentsTrendChartProps) {
  const sliced = sliceByFilter(data, timeFilter);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:scale-[1.01] hover:shadow-xl dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Appointments</h2>
        {onTimeFilterChange && (
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {(["day", "week", "month"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onTimeFilterChange(f)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ${
                  timeFilter === f
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {sliced.length ? (
        <div className="h-48 min-h-[192px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sliced}>
              <defs>
                <linearGradient id="aptGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => String(v).slice(-5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ padding: "8px 12px", borderRadius: 8 }} />
              <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#aptGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-zinc-500">No data</p>
      )}
    </div>
  );
}
