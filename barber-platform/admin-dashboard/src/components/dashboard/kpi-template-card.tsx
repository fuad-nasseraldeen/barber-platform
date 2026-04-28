"use client";

import type { DashboardKpiTemplate } from "@/lib/dashboard/kpi-template-config";
import { KPI_THEME_BY_TYPE } from "@/lib/dashboard/kpi-template-config";
import { KpiMiniChart } from "@/components/dashboard/kpi-mini-chart";

type KpiTemplateCardProps = {
  card: DashboardKpiTemplate;
  locale: string;
  isRtl: boolean;
  monthlyLabel: string;
  noBaselineLabel: string;
};

export function KpiTemplateCard({
  card,
  locale,
  isRtl,
  monthlyLabel,
  noBaselineLabel,
}: KpiTemplateCardProps) {
  const theme = KPI_THEME_BY_TYPE[card.type];
  const Icon = card.icon;
  const comparisonToneClass =
    card.comparisonTone === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : card.comparisonTone === "negative"
        ? "text-rose-700 dark:text-rose-300"
        : "text-zinc-700 dark:text-zinc-300";

  return (
    <article
      dir={isRtl ? "rtl" : "ltr"}
      className={`min-h-[212px] rounded-3xl border p-4 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out hover:-translate-y-0.5 sm:p-5 ${theme.cardClassName}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
            {card.title}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            {card.value.toLocaleString()}
          </p>
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full sm:h-11 sm:w-11 ${theme.iconBubbleClassName}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="rounded-2xl bg-white/50 px-2 pt-2 pb-1 dark:bg-zinc-950/40 min-h-[92px]">
        <KpiMiniChart
          data={card.chartSeries}
          color={theme.chartColor}
          locale={locale}
          isRtl={isRtl}
          startDate={card.chartStartDate}
          seriesLabel={card.title}
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${theme.badgeClassName}`}>
          {monthlyLabel}
        </span>
        {card.comparisonText ? (
          <span className={`text-xs font-semibold ${comparisonToneClass}`}>{card.comparisonText}</span>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{noBaselineLabel}</span>
        )}
      </div>
    </article>
  );
}
