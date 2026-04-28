"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useTranslation } from "@/hooks/use-translation";

type DatePreset = "this_month" | "last_month" | "last_30_days" | "custom";
type CompareMode = "previous_period" | "previous_month";

type AnalyticsResponse = {
  period: { startDate: string; endDate: string };
  revenueByStaff: Array<{ staffId: string; staffName: string; revenue: number; count: number }>;
  revenueByService: Array<{ serviceId: string; serviceName: string; revenue: number; count: number }>;
  customerRetention: {
    totalCustomers: number;
    repeatCustomers: number;
    retentionRate: number;
    newCustomers: number;
  };
  busyHours: Array<{ hour: number; count: number }>;
  dailyBookings: Array<{ date: string; count: number }>;
  staffPerformance: Array<{
    staffId: string;
    staffName: string;
    totalBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    revenue: number;
    completionRate: number;
  }>;
};

type WaitlistItem = {
  id: string;
  createdAt: string;
};

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function parseYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function setEndOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

function setStartOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function buildRangeFromPreset(preset: DatePreset, now: Date) {
  const today = setEndOfDay(now);
  if (preset === "this_month") {
    return { start: startOfMonth(now), end: today };
  }
  if (preset === "last_month") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    return { start: startOfMonth(d), end: endOfMonth(d) };
  }
  if (preset === "last_30_days") {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    return { start: setStartOfDay(start), end: today };
  }
  return { start: startOfMonth(now), end: today };
}

function buildComparisonRange(
  start: Date,
  end: Date,
  mode: CompareMode,
): { start: Date; end: Date } {
  if (mode === "previous_month") {
    const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, start.getUTCDate()));
    const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, end.getUTCDate(), 23, 59, 59, 999));
    return { start: s, end: e };
  }
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: setStartOfDay(prevStart), end: setEndOfDay(prevEnd) };
}

function pctChange(current: number, previous: number) {
  if (previous === 0) {
    if (current === 0) return { text: "0%", tone: "neutral" as const };
    return { text: "חדש", tone: "positive" as const };
  }
  const pct = ((current - previous) / previous) * 100;
  if (pct > 0) return { text: `+${pct.toFixed(1)}%`, tone: "positive" as const };
  if (pct < 0) return { text: `${pct.toFixed(1)}%`, tone: "negative" as const };
  return { text: "0%", tone: "neutral" as const };
}

function sumDaily(series: Array<{ count: number }>) {
  return series.reduce((acc, x) => acc + (x.count ?? 0), 0);
}

function sumRevenue(series: Array<{ revenue: number }>) {
  return series.reduce((acc, x) => acc + (x.revenue ?? 0), 0);
}

function countWaitlistInRange(list: WaitlistItem[], start: Date, end: Date) {
  return list.filter((x) => {
    const d = new Date(x.createdAt);
    return d >= start && d <= end;
  }).length;
}

function trendClasses(tone: "positive" | "negative" | "neutral") {
  if (tone === "positive") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "negative") return "text-red-600 dark:text-red-400";
  return "text-zinc-500 dark:text-zinc-400";
}

export default function AdminAnalyticsPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const branchId = useEffectiveBranchId(businessId);
  const now = new Date();

  const [preset, setPreset] = useState<DatePreset>("this_month");
  const initial = buildRangeFromPreset("this_month", now);
  const [customStart, setCustomStart] = useState(toYmd(initial.start));
  const [customEnd, setCustomEnd] = useState(toYmd(initial.end));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous_period");

  const currentRange = useMemo(() => {
    if (preset === "custom") {
      return {
        start: setStartOfDay(parseYmd(customStart)),
        end: setEndOfDay(parseYmd(customEnd)),
      };
    }
    return buildRangeFromPreset(preset, now);
  }, [preset, customStart, customEnd, now]);

  const comparisonRange = useMemo(
    () => buildComparisonRange(currentRange.start, currentRange.end, compareMode),
    [currentRange.start, currentRange.end, compareMode],
  );

  const currentQuery = useQuery<AnalyticsResponse>({
    queryKey: [
      "analytics-range",
      businessId,
      branchId ?? "all",
      toYmd(currentRange.start),
      toYmd(currentRange.end),
    ],
    queryFn: () =>
      apiClient<AnalyticsResponse>(
        `/analytics?businessId=${businessId}&startDate=${toYmd(currentRange.start)}&endDate=${toYmd(
          currentRange.end,
        )}${branchId ? `&branchId=${branchId}` : ""}`,
      ),
    enabled: !!businessId,
  });

  const compareQuery = useQuery<AnalyticsResponse>({
    queryKey: [
      "analytics-range-compare",
      businessId,
      branchId ?? "all",
      toYmd(comparisonRange.start),
      toYmd(comparisonRange.end),
    ],
    queryFn: () =>
      apiClient<AnalyticsResponse>(
        `/analytics?businessId=${businessId}&startDate=${toYmd(comparisonRange.start)}&endDate=${toYmd(
          comparisonRange.end,
        )}${branchId ? `&branchId=${branchId}` : ""}`,
      ),
    enabled: !!businessId,
  });

  const waitlistQuery = useQuery<WaitlistItem[]>({
    queryKey: ["analytics-waitlist", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<WaitlistItem[]>(
        `/waitlist?businessId=${businessId}${branchId ? `&branchId=${branchId}` : ""}&limit=2000&page=1`,
      ),
    enabled: !!businessId,
  });

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-3 text-2xl font-semibold">Analytics</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Please log in to view analytics.</p>
      </div>
    );
  }

  const current = currentQuery.data;
  const previous = compareQuery.data;
  const waitlist = waitlistQuery.data ?? [];

  const currentRevenue = current ? sumRevenue(current.revenueByService) : 0;
  const previousRevenue = previous ? sumRevenue(previous.revenueByService) : 0;
  const currentBookings = current ? sumDaily(current.dailyBookings) : 0;
  const previousBookings = previous ? sumDaily(previous.dailyBookings) : 0;
  const currentCustomers = current?.customerRetention.totalCustomers ?? 0;
  const previousCustomers = previous?.customerRetention.totalCustomers ?? 0;
  const currentRetention = current?.customerRetention.retentionRate ?? 0;
  const previousRetention = previous?.customerRetention.retentionRate ?? 0;
  const currentWaitlist = countWaitlistInRange(waitlist, currentRange.start, currentRange.end);
  const previousWaitlist = countWaitlistInRange(waitlist, comparisonRange.start, comparisonRange.end);

  const peakHourCurrent = current?.busyHours.reduce((max, h) => (h.count > max.count ? h : max), { hour: 0, count: 0 });
  const peakHourPrevious = previous?.busyHours.reduce((max, h) => (h.count > max.count ? h : max), { hour: 0, count: 0 });
  const topStaffCurrent = current?.staffPerformance.reduce(
    (max, s) => (s.revenue > max.revenue ? s : max),
    { staffId: "", staffName: "-", totalBookings: 0, completedBookings: 0, cancelledBookings: 0, revenue: 0, completionRate: 0 },
  );
  const topStaffPrevious = previous?.staffPerformance.reduce(
    (max, s) => (s.revenue > max.revenue ? s : max),
    { staffId: "", staffName: "-", totalBookings: 0, completedBookings: 0, cancelledBookings: 0, revenue: 0, completionRate: 0 },
  );

  const kpis = [
    {
      label: t("dashboard.customersBookedInRange"),
      value: currentCustomers,
      diff: pctChange(currentCustomers, previousCustomers),
    },
    {
      label: t("dashboard.treatmentsInRange"),
      value: currentBookings,
      diff: pctChange(currentBookings, previousBookings),
    },
    {
      label: t("dashboard.waitlistThisMonth"),
      value: currentWaitlist,
      diff: pctChange(currentWaitlist, previousWaitlist),
    },
    {
      label: "Revenue",
      value: currentRevenue.toFixed(2),
      diff: pctChange(currentRevenue, previousRevenue),
    },
    {
      label: "Retention %",
      value: `${currentRetention.toFixed(1)}%`,
      diff: pctChange(currentRetention, previousRetention),
    },
    {
      label: "Peak Hour Bookings",
      value: `${String(peakHourCurrent?.hour ?? 0).padStart(2, "0")}:00 (${peakHourCurrent?.count ?? 0})`,
      diff: pctChange(peakHourCurrent?.count ?? 0, peakHourPrevious?.count ?? 0),
    },
    {
      label: "Top Staff Revenue",
      value: `${topStaffCurrent?.staffName ?? "-"} (${(topStaffCurrent?.revenue ?? 0).toFixed(2)})`,
      diff: pctChange(topStaffCurrent?.revenue ?? 0, topStaffPrevious?.revenue ?? 0),
    },
  ];

  const isLoading = currentQuery.isLoading || compareQuery.isLoading || waitlistQuery.isLoading;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          השוואה אנליטית בין טווחים עם אחוז עליה/ירידה לכל כרטיס.
        </p>
      </div>

      <div className="mb-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">טווח מהיר</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="this_month">החודש</option>
            <option value="last_month">חודש שעבר</option>
            <option value="last_30_days">30 ימים אחרונים</option>
            <option value="custom">מותאם אישית</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">מתאריך</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => {
              setPreset("custom");
              setCustomStart(e.target.value);
            }}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">עד תאריך</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => {
              setPreset("custom");
              setCustomEnd(e.target.value);
            }}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">השוואה מול</span>
          <select
            value={compareMode}
            onChange={(e) => setCompareMode(e.target.value as CompareMode)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="previous_period">טווח קודם זהה</option>
            <option value="previous_month">חודש קודם</option>
          </select>
        </label>
      </div>

      <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        טווח נוכחי: {toYmd(currentRange.start)} עד {toYmd(currentRange.end)} | טווח השוואה:{" "}
        {toYmd(comparisonRange.start)} עד {toYmd(comparisonRange.end)}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {t("widget.loading")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{kpi.label}</p>
              <p className="mt-1 text-2xl font-semibold">{kpi.value}</p>
              <p className={`mt-1 text-sm ${trendClasses(kpi.diff.tone)}`}>
                {kpi.diff.text} לעומת טווח השוואה
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
