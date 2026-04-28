"use client";

import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { Skeleton } from "@/components/ui/skeleton";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => <Skeleton primary className="h-20 w-full rounded-xl" />,
});

type KpiMiniChartProps = {
  data: number[];
  color: string;
  locale: string;
  isRtl: boolean;
  startDate?: string;
  seriesLabel?: string;
};

export function KpiMiniChart({
  data,
  color,
  locale,
  isRtl,
  startDate,
  seriesLabel,
}: KpiMiniChartProps) {
  const normalized = data.length > 0 ? data : [0, 0, 0, 0, 0, 0, 0];
  const baseDate = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date();
  const points = normalized.map((value, index) => ({
    x: new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000).getTime(),
    y: value,
  }));
  const orderedPoints = isRtl ? [...points].reverse() : points;

  const options: ApexOptions = {
    chart: {
      type: "area",
      sparkline: { enabled: true },
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 450 },
    },
    stroke: {
      curve: "smooth",
      width: 2.75,
      lineCap: "round",
    },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.32,
        opacityTo: 0.03,
        stops: [0, 95, 100],
      },
    },
    colors: [color],
    tooltip: {
      enabled: true,
      x: {
        show: true,
        formatter: (value) =>
          new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(Number(value))),
      },
      y: {
        formatter: (value) => `${Math.round(value)}`,
      },
      marker: { show: false },
    },
    xaxis: {
      type: "datetime",
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    grid: { show: false },
    markers: { size: 0 },
    dataLabels: { enabled: false },
  };

  return (
    <div className="h-20 w-full min-h-[80px]">
      <ReactApexChart
        type="area"
        height="100%"
        width="100%"
        options={options}
        series={[{ name: seriesLabel ?? "Metric", data: orderedPoints }]}
      />
    </div>
  );
}
