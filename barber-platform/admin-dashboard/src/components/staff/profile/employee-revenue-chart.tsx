"use client";

import { Am5LineAreaChart } from "@/components/charts/am5-line-area-chart";

type EmployeeRevenueChartProps = {
  title: string;
  subtitle: string;
  data: Array<{ date: Date; value: number }>;
  isRtl: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
  showHeader?: boolean;
};

export function EmployeeRevenueChart({
  title,
  subtitle,
  data,
  isRtl,
  valuePrefix,
  valueSuffix,
  showHeader = true,
}: EmployeeRevenueChartProps) {
  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_20px_44px_-28px_rgba(0,0,0,0.5)] dark:border-zinc-700 dark:bg-zinc-900">
      {showHeader ? (
        <div className={isRtl ? "text-right" : "text-left"}>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
      ) : null}
      <Am5LineAreaChart
        data={data}
        isRtl={isRtl}
        height={320}
        valuePrefix={valuePrefix}
        valueSuffix={valueSuffix}
        className={showHeader ? "mt-3" : ""}
      />
    </article>
  );
}
