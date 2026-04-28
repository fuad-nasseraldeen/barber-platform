"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5percent from "@amcharts/amcharts5/percent";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import {
  createAmchartsRoot,
  disposeAmchartsRoot,
  resolveAmchartsPalette,
  type AmchartsPalette,
} from "@/lib/amcharts";

type DonutPoint = {
  label: string;
  value: number;
  color?: string;
};

type Am5DonutChartProps = {
  data: DonutPoint[];
  height?: number;
  className?: string;
  paletteOverrides?: Partial<AmchartsPalette>;
};

export function Am5DonutChart({
  data,
  height = 240,
  className,
  paletteOverrides,
}: Am5DonutChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartData = useMemo(() => {
    const palette = resolveAmchartsPalette(paletteOverrides);
    const fallback = [palette.primary, palette.secondary, palette.tertiary, "#94a3b8"];

    const normalized = data.length > 0 ? data : [{ label: "N/A", value: 1 }];
    return normalized.map((item, index) => ({
      category: item.label,
      value: item.value,
      sliceSettings: {
        fill: am5.color(item.color ?? fallback[index % fallback.length]),
      },
    }));
  }, [data, paletteOverrides]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const root = createAmchartsRoot(element);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.verticalLayout,
      }),
    );

    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        valueField: "value",
        categoryField: "category",
        innerRadius: am5.percent(62),
        alignLabels: false,
      }),
    );

    series.labels.template.setAll({
      forceHidden: true,
    });

    series.ticks.template.setAll({
      forceHidden: true,
    });

    series.slices.template.setAll({
      cornerRadius: 8,
      strokeOpacity: 0,
      tooltipText: "{category}: {valuePercentTotal.formatNumber('0.0')}%",
    });

    series.data.setAll(chartData);
    series.appear(450, 80);

    return () => {
      disposeAmchartsRoot(element);
    };
  }, [chartData]);

  return <div ref={containerRef} className={className} style={{ height }} aria-hidden="true" />;
}
