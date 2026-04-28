"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import {
  createAmchartsRoot,
  disposeAmchartsRoot,
  resolveAmchartsPalette,
  type AmchartsPalette,
} from "@/lib/amcharts";

type DataPoint = {
  date: Date;
  value: number;
};

type Am5LineAreaChartProps = {
  data: DataPoint[];
  color?: string;
  height?: number;
  isRtl?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
  className?: string;
  paletteOverrides?: Partial<AmchartsPalette>;
};

export function Am5LineAreaChart({
  data,
  color,
  height = 220,
  isRtl = false,
  valuePrefix = "",
  valueSuffix = "",
  className,
  paletteOverrides,
}: Am5LineAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesData = useMemo(
    () =>
      (data.length > 0 ? data : [{ date: new Date(), value: 0 }]).map((point) => ({
        date: point.date.getTime(),
        value: point.value,
      })),
    [data],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const palette = resolveAmchartsPalette(paletteOverrides);
    const root = createAmchartsRoot(element);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        wheelX: "none",
        wheelY: "none",
        layout: root.verticalLayout,
      }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.DateAxis.new(root, {
        maxDeviation: 0,
        baseInterval: { timeUnit: "day", count: 1 },
        renderer: am5xy.AxisRendererX.new(root, {
          minGridDistance: 36,
          inversed: isRtl,
        }),
        tooltip: am5.Tooltip.new(root, {}),
      }),
    );

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {
          minGridDistance: 30,
        }),
      }),
    );

    xAxis.get("renderer").labels.template.setAll({
      fill: am5.color(palette.mutedText),
      fontSize: 11,
    });
    xAxis.get("renderer").grid.template.setAll({
      stroke: am5.color(palette.grid),
      strokeOpacity: 0.3,
    });
    yAxis.get("renderer").labels.template.setAll({
      fill: am5.color(palette.mutedText),
      fontSize: 11,
    });
    yAxis.get("renderer").grid.template.setAll({
      stroke: am5.color(palette.grid),
      strokeOpacity: 0.25,
    });

    const series = chart.series.push(
      am5xy.LineSeries.new(root, {
        xAxis,
        yAxis,
        valueYField: "value",
        valueXField: "date",
        stroke: am5.color(color ?? palette.primary),
        fill: am5.color(color ?? palette.primary),
        tooltip: am5.Tooltip.new(root, {
          labelText: `${valuePrefix}{valueY.formatNumber('#,###')}${valueSuffix}`,
        }),
      }),
    );

    series.strokes.template.setAll({
      strokeWidth: 3,
    });

    series.fills.template.setAll({
      visible: true,
      fillOpacity: 1,
      fillGradient: am5.LinearGradient.new(root, {
        rotation: 90,
        stops: [
          { color: am5.color(color ?? palette.primary), opacity: 0.32 },
          { color: am5.color(color ?? palette.primary), opacity: 0.04 },
        ],
      }),
    });

    series.bullets.push(() =>
      am5.Bullet.new(root, {
        sprite: am5.Circle.new(root, {
          radius: 4,
          fill: am5.color(color ?? palette.primary),
          stroke: am5.color(palette.surface),
          strokeWidth: 2,
          opacity: 0.9,
          tooltipY: 0,
        }),
      }),
    );

    series.data.setAll(seriesData);
    series.appear(450);
    chart.appear(450, 80);

    return () => {
      disposeAmchartsRoot(element);
    };
  }, [color, isRtl, paletteOverrides, seriesData, valuePrefix, valueSuffix]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height }}
      aria-hidden="true"
    />
  );
}
