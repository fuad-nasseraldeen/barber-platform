"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, CircleDollarSign, Goal, HandCoins, Sparkles } from "lucide-react";
import { EmployeeAlertsPanel } from "@/components/staff/profile/employee-alerts-panel";
import { EmployeeKpiGrid } from "@/components/staff/profile/employee-kpi-grid";
import { EmployeeProfileHeader } from "@/components/staff/profile/employee-profile-header";
import { EmployeeRevenueChart } from "@/components/staff/profile/employee-revenue-chart";
import { EmployeeSettlementModelCard } from "@/components/staff/profile/employee-settlement-model-card";
import { EmployeeSettlementSummary } from "@/components/staff/profile/employee-settlement-summary";
import type { EmployeeKpiItem, EmployeeProfileInfo } from "@/components/staff/profile/types";
import type { EmployeeSettlementModel } from "@/lib/staff/employee-settlement";

type EarningsAppointment = {
  id: string;
  startTime: string;
  status?: string;
  customer?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  payment?: {
    amount?: number | string | null;
    status?: string | null;
  } | null;
  service?: {
    name?: string | null;
    price?: number | string | null;
  } | null;
  revenueUsed?: number | string | null;
};

type StaffEarningsSummary = {
  settlementModel: EmployeeSettlementModel;
  completedAppointmentsCount: number;
  totalRevenue: number;
  grossEarnings: number;
  advancesTotal: number;
  alreadyPaidTotal: number;
  remainingToPay: number;
  finalPayable: number;
  noShowCount: number;
  cancelledCount: number;
  confirmedNoShowCount: number;
  confirmationTrackingEnabled: boolean;
  eligibleAppointments: EarningsAppointment[];
  previousPeriodComparison?: {
    completedAppointmentsCount: number;
    totalRevenue: number;
    finalPayable: number;
    revenueDeltaPercent: number | null;
    completedDeltaPercent: number | null;
    payableDeltaPercent: number | null;
  };
  settlementConfig?: {
    boothRentalAmount?: number;
    businessCutPercent?: number;
    fixedAmountPerTreatment?: number;
    allowNegativeBalance?: boolean;
  };
};

type EmployeePerformanceDashboardProps = {
  profile: EmployeeProfileInfo;
  isRtl: boolean;
  earningsSummary: StaffEarningsSummary | null;
  monthlyTargetRevenue: number;
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
};

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfCurrentMonthYmd(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapModelLabel(model: EmployeeSettlementModel, t: (key: string) => string): string {
  if (model === "boothRental") return t("employeeDashboard.model.boothRental");
  if (model === "fixedPerTreatment") return t("employeeDashboard.model.fixedPerTreatment");
  return t("employeeDashboard.model.percentage");
}

export function EmployeePerformanceDashboard({
  profile,
  isRtl,
  earningsSummary,
  monthlyTargetRevenue,
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
  onExportCsv,
  onExportPdf,
  formatCurrency,
  t,
}: EmployeePerformanceDashboardProps) {
  const [chartMetric, setChartMetric] = useState<"revenue" | "treatments">("revenue");

  const appointments = earningsSummary?.eligibleAppointments ?? [];
  const settlementModel = earningsSummary?.settlementModel ?? "percentage";
  const treatmentsCount = earningsSummary?.completedAppointmentsCount ?? 0;
  const totalRevenue = earningsSummary?.totalRevenue ?? 0;
  const boothRentalAmount = Math.max(0, Number(earningsSummary?.settlementConfig?.boothRentalAmount ?? 0));
  const businessCutPercent = Math.max(
    0,
    Math.min(100, Number(earningsSummary?.settlementConfig?.businessCutPercent ?? 20)),
  );
  const fixedAmountPerTreatment = Math.max(
    0,
    Number(earningsSummary?.settlementConfig?.fixedAmountPerTreatment ?? 0),
  );
  const allowNegativeBalance = earningsSummary?.settlementConfig?.allowNegativeBalance === true;

  const summary = useMemo(
    () => ({
      grossBeforeAdvances: Math.max(0, Number(earningsSummary?.grossEarnings ?? 0)),
      advancesDeducted: Math.max(0, Number(earningsSummary?.advancesTotal ?? 0)),
      afterAdvances:
        Math.max(0, Number(earningsSummary?.grossEarnings ?? 0)) -
        Math.max(0, Number(earningsSummary?.advancesTotal ?? 0)),
      alreadyPaid: Math.max(0, Number(earningsSummary?.alreadyPaidTotal ?? 0)),
      remainingToPay: Number(earningsSummary?.remainingToPay ?? 0),
      isNegative: Number(earningsSummary?.remainingToPay ?? 0) < 0,
    }),
    [earningsSummary],
  );

  const rangeDays = useMemo(() => {
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return [] as string[];
    const start = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    const days: string[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d).toISOString().slice(0, 10));
    }

    return days;
  }, [rangeEnd, rangeStart]);

  const revenueByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const appointment of appointments) {
      const day = appointment.startTime.slice(0, 10);
      const revenue = safeNumber(appointment.revenueUsed ?? appointment.payment?.amount ?? appointment.service?.price ?? 0);
      map.set(day, (map.get(day) ?? 0) + revenue);
    }

    return rangeDays.map((day) => ({
      date: new Date(`${day}T00:00:00`),
      value: Math.round(map.get(day) ?? 0),
    }));
  }, [appointments, rangeDays]);

  const treatmentsByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const appointment of appointments) {
      const day = appointment.startTime.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }

    return rangeDays.map((day) => ({
      date: new Date(`${day}T00:00:00`),
      value: map.get(day) ?? 0,
    }));
  }, [appointments, rangeDays]);

  const goalProgressPercent =
    monthlyTargetRevenue > 0 ? (totalRevenue / monthlyTargetRevenue) * 100 : 0;

  const dashboardStatusTone: EmployeeProfileInfo["statusTone"] =
    summary.remainingToPay < 0
      ? "negative"
      : treatmentsCount === 0 || goalProgressPercent < 35
        ? "risk"
        : "active";

  const dashboardStatusLabel =
    dashboardStatusTone === "negative"
      ? t("employeeDashboard.status.negative")
      : dashboardStatusTone === "risk"
        ? t("employeeDashboard.status.risk")
        : t("employeeDashboard.status.active");

  const rangePresetLabel =
    rangeStart === startOfCurrentMonthYmd() && rangeEnd === todayYmd()
      ? t("employeeDashboard.range.thisMonth")
      : `${rangeStart} - ${rangeEnd}`;

  const kpis: EmployeeKpiItem[] = [
    {
      id: "treatments",
      icon: Sparkles,
      label: t("employeeDashboard.kpi.treatments"),
      value: treatmentsCount,
      secondary:
        earningsSummary?.previousPeriodComparison?.completedDeltaPercent != null
          ? `${earningsSummary.previousPeriodComparison.completedDeltaPercent > 0 ? "+" : ""}${earningsSummary.previousPeriodComparison.completedDeltaPercent}%`
          : t("employeeDashboard.kpi.secondary.completedInRange"),
      tone: "default",
    },
    {
      id: "revenue",
      icon: CircleDollarSign,
      label: t("employeeDashboard.kpi.revenue"),
      value: totalRevenue,
      valuePrefix: t("employeeDashboard.currencyPrefix"),
      secondary:
        earningsSummary?.previousPeriodComparison?.revenueDeltaPercent != null
          ? `${earningsSummary.previousPeriodComparison.revenueDeltaPercent > 0 ? "+" : ""}${earningsSummary.previousPeriodComparison.revenueDeltaPercent}% ${t("dashboard.vsLastMonth")}`
          : t("employeeDashboard.kpi.secondary.generatedInRange"),
      tone: "positive",
    },
    {
      id: "goal",
      icon: Goal,
      label: t("employeeDashboard.kpi.goalProgress"),
      value: Math.max(0, Math.min(999, goalProgressPercent)),
      valueSuffix: "%",
      secondary: `${formatCurrency(totalRevenue)} / ${formatCurrency(monthlyTargetRevenue)}`,
      tone: goalProgressPercent >= 100 ? "positive" : "warning",
    },
    {
      id: "payable",
      icon: HandCoins,
      label: t("employeeDashboard.kpi.remainingPayable"),
      value: Math.abs(summary.remainingToPay),
      valuePrefix: t("employeeDashboard.currencyPrefix"),
      secondary:
        summary.remainingToPay < 0
          ? t("employeeDashboard.kpi.secondary.overpaid")
          : t("employeeDashboard.kpi.secondary.toBePaid"),
      tone: summary.remainingToPay < 0 ? "negative" : "default",
    },
    {
      id: "noShow",
      icon: CalendarDays,
      label: t("employeeDashboard.insights.noShows"),
      value: earningsSummary?.noShowCount ?? 0,
      secondary: t("employeeDashboard.kpi.secondary.completedInRange"),
      tone: (earningsSummary?.noShowCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      id: "cancelled",
      icon: CalendarDays,
      label: t("employeeDashboard.insights.cancellations"),
      value: earningsSummary?.cancelledCount ?? 0,
      secondary: t("employeeDashboard.kpi.secondary.completedInRange"),
      tone: (earningsSummary?.cancelledCount ?? 0) > 0 ? "warning" : "default",
    },
  ];

  if (earningsSummary?.confirmationTrackingEnabled) {
    kpis.push({
      id: "confirmedNoShow",
      icon: CalendarDays,
      label: t("employeeDashboard.confirmedNoShow"),
      value: earningsSummary?.confirmedNoShowCount ?? 0,
      secondary: t("employeeDashboard.confirmedNoShowHint"),
      tone: (earningsSummary?.confirmedNoShowCount ?? 0) > 0 ? "negative" : "default",
    });
  }

  const formulaText = useMemo(() => {
    if (settlementModel === "boothRental") {
      return `${t("employeeDashboard.formula.boothRental")}: ${formatCurrency(boothRentalAmount)}`;
    }

    if (settlementModel === "fixedPerTreatment") {
      return `${t("employeeDashboard.formula.fixedPerTreatment")} = ${formatCurrency(totalRevenue)} - (${treatmentsCount} × ${formatCurrency(
        fixedAmountPerTreatment,
      )})`;
    }

    return `${t("employeeDashboard.formula.percentage")} = ${formatCurrency(totalRevenue)} × ${(100 - businessCutPercent).toFixed(
      0,
    )}%`;
  }, [
    boothRentalAmount,
    businessCutPercent,
    fixedAmountPerTreatment,
    formatCurrency,
    settlementModel,
    t,
    totalRevenue,
    treatmentsCount,
  ]);

  const alerts = useMemo(() => {
    const items: Array<{ id: string; message: string; tone: "warning" | "danger" | "info" }> = [];

    if (summary.remainingToPay < 0) {
      items.push({
        id: "overpaid",
        message: t("employeeDashboard.alert.overpaid"),
        tone: "danger",
      });
    }

    if (summary.isNegative && !allowNegativeBalance) {
      items.push({
        id: "negativeNotAllowed",
        message: t("employeeDashboard.alert.negativeNotAllowed"),
        tone: "warning",
      });
    }

    if ((earningsSummary?.noShowCount ?? 0) > 0) {
      items.push({
        id: "noShows",
        message: `${t("employeeDashboard.insights.noShows")}: ${earningsSummary?.noShowCount ?? 0}`,
        tone: "warning",
      });
    }

    if ((earningsSummary?.cancelledCount ?? 0) > 0) {
      items.push({
        id: "cancelled",
        message: `${t("employeeDashboard.insights.cancellations")}: ${earningsSummary?.cancelledCount ?? 0}`,
        tone: "info",
      });
    }

    if (
      earningsSummary?.confirmationTrackingEnabled &&
      (earningsSummary?.confirmedNoShowCount ?? 0) > 0
    ) {
      items.push({
        id: "confirmedNoShow",
        message: `${t("employeeDashboard.confirmedNoShow")}: ${earningsSummary?.confirmedNoShowCount ?? 0}`,
        tone: "danger",
      });
    }

    if (treatmentsCount === 0) {
      items.push({
        id: "noData",
        message: t("employeeDashboard.alert.noTreatmentsInRange"),
        tone: "info",
      });
    }

    return items;
  }, [allowNegativeBalance, earningsSummary, summary.isNegative, summary.remainingToPay, t, treatmentsCount]);

  const chartTitle =
    chartMetric === "revenue"
      ? t("employeeDashboard.charts.revenueOverTime")
      : t("employeeDashboard.charts.treatmentsOverTime");
  const chartSubtitle =
    chartMetric === "revenue"
      ? t("employeeDashboard.charts.revenueOverTimeSubtitle")
      : t("employeeDashboard.charts.treatmentsOverTimeSubtitle");
  const chartData = chartMetric === "revenue" ? revenueByDay : treatmentsByDay;

  return (
    <div className="mb-6 space-y-5">
      <EmployeeProfileHeader
        profile={{
          ...profile,
          statusTone: dashboardStatusTone,
          statusLabel: dashboardStatusLabel,
          settlementModel,
        }}
        subtitle={t("employeeDashboard.headerSubtitle")}
        settlementModelLabel={mapModelLabel(settlementModel, t)}
        earningsLabel={t("employeeDashboard.headerCurrentEarnings")}
        earningsValue={formatCurrency(summary.remainingToPay)}
        rangeLabel={rangePresetLabel}
        isRtl={isRtl}
      />

      <div className={`flex flex-wrap items-center gap-2 ${isRtl ? "justify-end" : ""}`}>
        <button
          type="button"
          onClick={() => {
            onRangeStartChange(startOfCurrentMonthYmd());
            onRangeEndChange(todayYmd());
          }}
          className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-600"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {t("employeeDashboard.range.currentMonth")}
        </button>
        <button
          type="button"
          onClick={onExportCsv}
          className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-600"
        >
          {t("employeeDashboard.actions.exportCsv")}
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-600"
        >
          {t("employeeDashboard.actions.exportPdf")}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="rounded-2xl border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">{t("employeeDashboard.range.from")}</span>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => onRangeStartChange(e.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="rounded-2xl border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">{t("employeeDashboard.range.to")}</span>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => onRangeEndChange(e.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
      </div>

      <EmployeeKpiGrid items={kpis} isRtl={isRtl} />

      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_22px_48px_-30px_rgba(0,0,0,0.5)] dark:border-zinc-700 dark:bg-zinc-900">
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 ${isRtl ? "flex-row-reverse" : ""}`}>
          <div className={isRtl ? "text-right" : "text-left"}>
            <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              <BarChart3 className="h-4 w-4 text-primary" />
              {chartTitle}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{chartSubtitle}</p>
          </div>
          <div className="inline-flex rounded-xl border border-zinc-200 p-1 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setChartMetric("revenue")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                chartMetric === "revenue"
                  ? "bg-primary text-primary-foreground"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {t("employeeDashboard.charts.revenueShort")}
            </button>
            <button
              type="button"
              onClick={() => setChartMetric("treatments")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                chartMetric === "treatments"
                  ? "bg-primary text-primary-foreground"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {t("employeeDashboard.charts.treatmentsShort")}
            </button>
          </div>
        </div>
        <EmployeeRevenueChart
          title={chartTitle}
          subtitle={chartSubtitle}
          data={chartData}
          isRtl={isRtl}
          valuePrefix={chartMetric === "revenue" ? t("employeeDashboard.currencyPrefix") : undefined}
          valueSuffix={chartMetric === "treatments" ? t("employeeDashboard.charts.itemsSuffix") : undefined}
          showHeader={false}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EmployeeSettlementModelCard
          title={t("employeeDashboard.settlement.modelTitle")}
          selectedModel={settlementModel}
          onModelChange={() => {}}
          formulaText={formulaText}
          isRtl={isRtl}
          labels={{
            boothRental: t("employeeDashboard.model.boothRental"),
            percentage: t("employeeDashboard.model.percentage"),
            fixedPerTreatment: t("employeeDashboard.model.fixedPerTreatment"),
            modelLabel: t("employeeDashboard.settlement.modelLabel"),
            formulaLabel: t("employeeDashboard.settlement.formulaLabel"),
            boothAmount: t("employeeDashboard.settlement.boothAmount"),
            businessCutPercent: t("employeeDashboard.settlement.businessCutPercent"),
            fixedAmountPerTreatment: t("employeeDashboard.settlement.fixedAmountPerTreatment"),
            allowNegativeBalance: t("employeeDashboard.settlement.allowNegativeBalance"),
            alreadyPaid: t("employeeDashboard.settlement.alreadyPaid"),
          }}
          inputs={{
            boothRentalAmount,
            businessCutPercent,
            fixedAmountPerTreatment,
            allowNegativeBalance,
            alreadyPaid: Math.max(0, Number(earningsSummary?.alreadyPaidTotal ?? 0)),
          }}
          onInputsChange={{
            setBoothRentalAmount: () => {},
            setBusinessCutPercent: () => {},
            setFixedAmountPerTreatment: () => {},
            setAllowNegativeBalance: () => {},
            setAlreadyPaid: () => {},
          }}
          readOnly
        />

        <EmployeeSettlementSummary
          title={t("employeeDashboard.settlement.summaryTitle")}
          summary={summary}
          formatCurrency={formatCurrency}
          isRtl={isRtl}
          labels={{
            grossBeforeAdvances: t("employeeDashboard.settlement.grossBeforeAdvances"),
            advances: t("employeeDashboard.settlement.advances"),
            afterAdvances: t("employeeDashboard.settlement.afterAdvances"),
            alreadyPaid: t("employeeDashboard.settlement.alreadyPaid"),
            remainingToPay: t("employeeDashboard.settlement.remainingToPay"),
            finalPayable: t("employeeDashboard.settlement.finalPayable"),
          }}
        />
      </section>

      <section className="grid gap-4">
        <EmployeeAlertsPanel
          title={t("employeeDashboard.alerts.title")}
          alerts={alerts}
          isRtl={isRtl}
          emptyLabel={t("employeeDashboard.alerts.empty")}
        />
      </section>

      <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${isRtl ? "text-right" : "text-left"}`}>
        {t("employeeDashboard.integrationHint")}
      </p>
    </div>
  );
}
