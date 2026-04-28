"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Scissors, UserRoundPlus, Users } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import type {
  ComparisonTone,
  DashboardTemplateCard,
  TeamGoalsMember,
} from "@/lib/dashboard/kpi-template-config";
import { isDashboardKpiTemplate } from "@/lib/dashboard/kpi-template-config";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import {
  DashboardKpiCardSkeleton,
  TeamGoalsCardSkeleton,
} from "@/components/ui/skeleton";
import { BackgroundRefreshIndicator } from "@/components/ui/background-refresh-indicator";

const KpiTemplateCard = dynamic(
  () =>
    import("@/components/dashboard/kpi-template-card").then(
      (mod) => mod.KpiTemplateCard,
    ),
  {
    loading: () => <DashboardKpiCardSkeleton />,
  },
);

const TeamGoalsProgressCard = dynamic(
  () =>
    import("@/components/dashboard/team-goals-progress-card").then(
      (mod) => mod.TeamGoalsProgressCard,
    ),
  {
    loading: () => <TeamGoalsCardSkeleton />,
  },
);

type AppointmentKpiItem = {
  id: string;
  startTime: string;
  customerId?: string;
  customer?: { id?: string | null } | null;
};

type WaitlistKpiItem = {
  id: string;
  createdAt: string;
};

type StaffScopeItem = {
  id: string;
  firstName: string;
  lastName: string;
};

type BusinessGeneralSettings = {
  settings?: {
    generalSettings?: {
      hideStatistics?: boolean;
      hideEmployeeStatistics?: boolean;
    };
  };
};

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(base = new Date()) {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const prevMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const currentMonthStart = new Date(Date.UTC(year, month, 1));
  const currentMonthEnd = new Date(Date.UTC(year, month + 1, 0));
  return { prevMonthStart, currentMonthStart, currentMonthEnd };
}

function daysInUtcMonth(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function percentageText(current: number, previous: number, t: (key: string) => string): {
  text?: string;
  tone?: ComparisonTone;
} {
  if (previous <= 0) {
    if (current <= 0) return { text: undefined, tone: "neutral" };
    return { text: t("dashboard.newVsLastMonth"), tone: "positive" };
  }
  const delta = ((current - previous) / previous) * 100;
  const sign = delta > 0 ? "+" : "";
  return {
    text: `${sign}${delta.toFixed(0)}% ${t("dashboard.vsLastMonth")}`,
    tone: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
  };
}

function buildDailySeries(
  items: Date[],
  rangeStart: Date,
  rangeEnd: Date,
) {
  const dayCount =
    Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) +
    1;
  const series = new Array(Math.max(0, dayCount)).fill(0);

  for (const d of items) {
    if (d < rangeStart || d > rangeEnd) continue;
    const dayOffset = Math.floor(
      (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        Date.UTC(
          rangeStart.getUTCFullYear(),
          rangeStart.getUTCMonth(),
          rangeStart.getUTCDate(),
        )) /
        (24 * 60 * 60 * 1000),
    );
    if (dayOffset >= 0 && dayOffset < series.length) {
      series[dayOffset] += 1;
    }
  }

  return series;
}

function buildUniqueCustomersSeriesByDay(
  items: AppointmentKpiItem[],
  rangeStart: Date,
  rangeEnd: Date,
) {
  const dayCount =
    Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) +
    1;
  const series = new Array(Math.max(0, dayCount)).fill(0);
  const map = new Map<string, Set<string>>();

  for (const item of items) {
    const date = new Date(item.startTime);
    if (date < rangeStart || date > rangeEnd) continue;
    const customerId = String(item.customerId ?? item.customer?.id ?? "");
    if (!customerId) continue;
    const ymd = toYmd(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
    const bucket = map.get(ymd) ?? new Set<string>();
    bucket.add(customerId);
    map.set(ymd, bucket);
  }

  for (let i = 0; i < series.length; i++) {
    const dayDate = new Date(
      Date.UTC(
        rangeStart.getUTCFullYear(),
        rangeStart.getUTCMonth(),
        rangeStart.getUTCDate() + i,
      ),
    );
    series[i] = map.get(toYmd(dayDate))?.size ?? 0;
  }

  return series;
}

export default function AdminDashboardPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const dir = useLocaleStore((s) => s.dir);
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const userRole = useAuthStore((s) => s.user?.role);
  const userStaffId = useAuthStore((s) => s.user?.staffId);
  const canSelectStaffScope = userRole === "owner" || userRole === "manager";
  const branchId = useEffectiveBranchId(businessId);
  const now = new Date();
  const { prevMonthStart, currentMonthStart, currentMonthEnd } = monthRange(now);
  const currentDay = now.getUTCDate();
  const [fromDay, setFromDay] = useState(1);
  const [toDay, setToDay] = useState(currentDay);
  const [selectedStaffScope, setSelectedStaffScope] = useState<string>("all");
  const scopedStaffId =
    userRole === "staff"
      ? userStaffId
      : canSelectStaffScope && selectedStaffScope !== "all"
        ? selectedStaffScope
        : undefined;
  const isStaffScopedDashboard = !!scopedStaffId;

  const { data: staffScopeOptions, isFetching: staffScopeFetching } = useQuery<StaffScopeItem[]>({
    queryKey: ["dashboard-staff-scope-options", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<StaffScopeItem[]>(
        `/staff?businessId=${businessId}${branchId ? `&branchId=${branchId}` : ""}&includeInactive=false`,
      ),
    enabled: !!businessId && canSelectStaffScope,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: businessSettings } = useQuery<BusinessGeneralSettings>({
    queryKey: ["business", businessId],
    queryFn: () => apiClient<BusinessGeneralSettings>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const hideStatistics =
    businessSettings?.settings?.generalSettings?.hideStatistics === true;
  const hideEmployeeStatistics =
    businessSettings?.settings?.generalSettings?.hideEmployeeStatistics === true;

  const safeFromDay = Math.min(fromDay, toDay);
  const safeToDay = Math.max(fromDay, toDay);
  const currentRangeStart = new Date(
    Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth(), safeFromDay, 0, 0, 0, 0),
  );
  const currentRangeEnd = new Date(
    Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth(), safeToDay, 23, 59, 59, 999),
  );

  const prevMonthDays = daysInUtcMonth(prevMonthStart);
  const prevFromDay = Math.min(safeFromDay, prevMonthDays);
  const prevToDay = Math.min(safeToDay, prevMonthDays);
  const prevRangeStart = new Date(
    Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), prevFromDay, 0, 0, 0, 0),
  );
  const prevRangeEnd = new Date(
    Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), prevToDay, 23, 59, 59, 999),
  );

  const appointmentsRangeStart = toYmd(prevMonthStart);
  const appointmentsRangeEnd = toYmd(now);

  const {
    data: appointments,
    isLoading: appointmentsLoading,
    isFetching: appointmentsFetching,
  } = useQuery<
    AppointmentKpiItem[]
  >({
    queryKey: [
      "dashboard-kpi-appointments",
      businessId,
      branchId ?? "all",
      scopedStaffId ?? "all-staff",
      appointmentsRangeStart,
      appointmentsRangeEnd,
    ],
    queryFn: async () => {
      const response = await apiClient<{ appointments: AppointmentKpiItem[] }>(
        `/appointments?businessId=${businessId}&startDate=${appointmentsRangeStart}&endDate=${appointmentsRangeEnd}&limit=1000${branchId ? `&branchId=${branchId}` : ""}${scopedStaffId ? `&staffId=${scopedStaffId}` : ""}`,
      );
      return response.appointments ?? [];
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: waitlist,
    isLoading: waitlistLoading,
    isFetching: waitlistFetching,
  } = useQuery<
    WaitlistKpiItem[]
  >({
    queryKey: [
      "dashboard-kpi-waitlist",
      businessId,
      branchId ?? "all",
      isStaffScopedDashboard ? "staff-hidden" : "enabled",
    ],
    queryFn: async () => {
      const response = await apiClient<WaitlistKpiItem[]>(
        `/waitlist?businessId=${businessId}${branchId ? `&branchId=${branchId}` : ""}&limit=500`,
      );
      return response ?? [];
    },
    enabled: !!businessId && !isStaffScopedDashboard,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const cards = useMemo<DashboardTemplateCard[]>(() => {
    const items = appointments ?? [];
    const appointmentDates = items.map((a) => new Date(a.startTime));
    const currentRangeItems = items.filter((a) => {
      const d = new Date(a.startTime);
      return d >= currentRangeStart && d <= currentRangeEnd;
    });
    const prevRangeItems = items.filter((a) => {
      const d = new Date(a.startTime);
      return d >= prevRangeStart && d <= prevRangeEnd;
    });

    const currentRangeAppointments = currentRangeItems.length;
    const previousRangeAppointments = prevRangeItems.length;
    const treatmentsComparison = percentageText(
      currentRangeAppointments,
      previousRangeAppointments,
      t,
    );

    const currentRangeCustomersSet = new Set(
      currentRangeItems
        .map((a) => a.customerId ?? a.customer?.id ?? "")
        .filter(Boolean),
    );
    const previousRangeCustomersSet = new Set(
      prevRangeItems
        .map((a) => a.customerId ?? a.customer?.id ?? "")
        .filter(Boolean),
    );
    const customersComparison = percentageText(
      currentRangeCustomersSet.size,
      previousRangeCustomersSet.size,
      t,
    );

    const waitlistItems = (waitlist ?? []).map((w) => new Date(w.createdAt));
    const currentMonthWaitlist = waitlistItems.filter(
      (d) => d >= currentMonthStart,
    ).length;
    const previousMonthWaitlist = waitlistItems.filter(
      (d) => d >= prevMonthStart && d < currentMonthStart,
    ).length;
    const waitlistComparison = percentageText(
      currentMonthWaitlist,
      previousMonthWaitlist,
      t,
    );

    const customerSeries = buildUniqueCustomersSeriesByDay(
      currentRangeItems,
      currentRangeStart,
      currentRangeEnd,
    );
    const treatmentSeries = buildDailySeries(
      appointmentDates.filter(
        (d) => d >= currentRangeStart && d <= currentRangeEnd,
      ),
      currentRangeStart,
      currentRangeEnd,
    );
    const waitlistSeries = buildDailySeries(
      waitlistItems.filter((d) => d >= currentMonthStart),
      currentMonthStart,
      currentMonthEnd,
    );

    const ownerMember: TeamGoalsMember = {
      id: String(user?.id ?? "owner"),
      name: user?.name?.trim() || user?.email || t("role.owner"),
      avatarUrl: null,
      role: t("role.owner"),
      progressPercent: 82,
      rank: 1,
      isOwner: true,
    };

    const baseCards: DashboardTemplateCard[] = [];
    if (!hideStatistics) {
      baseCards.push(
        {
          id: "kpi-customers-month-to-date",
          type: "customers",
          title: t("dashboard.customersBookedInRange"),
          value: currentRangeCustomersSet.size,
          comparisonText: customersComparison.text,
          comparisonTone: customersComparison.tone,
          icon: Users,
          chartSeries: customerSeries,
          chartStartDate: toYmd(currentRangeStart),
          visible: true,
        },
        {
          id: "kpi-treatments-month-to-date",
          type: "treatments",
          title: t("dashboard.treatmentsInRange"),
          value: currentRangeAppointments,
          comparisonText: treatmentsComparison.text,
          comparisonTone: treatmentsComparison.tone,
          icon: Scissors,
          chartSeries: treatmentSeries,
          chartStartDate: toYmd(currentRangeStart),
          visible: true,
        },
      );
    }

    if (isStaffScopedDashboard) {
      return baseCards;
    }

    const allCards = [...baseCards];
    if (!hideStatistics) {
      allCards.push({
        id: "kpi-waitlist-month-to-date",
        type: "waitlist",
        title: t("dashboard.waitlistThisMonth"),
        value: currentMonthWaitlist,
        comparisonText: waitlistComparison.text,
        comparisonTone: waitlistComparison.tone,
        icon: UserRoundPlus,
        chartSeries: waitlistSeries,
        chartStartDate: toYmd(currentMonthStart),
        visible: true,
      });
    }
    if (!hideEmployeeStatistics) {
      allCards.push({
        id: "team-goals-progress-monthly",
        type: "teamGoalsProgress",
        title: t("dashboard.teamGoalsProgress"),
        subtitle: t("dashboard.monthlyTargetCompletion"),
        ownerMember,
        members: [
          ownerMember,
          {
            id: "team-member-2",
            name: "Ariel Cohen",
            avatarUrl: null,
            role: t("dashboard.teamRoleSeniorStylist"),
            progressPercent: 74,
            rank: 2,
          },
          {
            id: "team-member-3",
            name: "Noa Levi",
            avatarUrl: null,
            role: t("dashboard.teamRoleBarber"),
            progressPercent: 67,
            rank: 3,
          },
          {
            id: "team-member-4",
            name: "Daniel Peretz",
            avatarUrl: null,
            role: t("dashboard.teamRoleJuniorBarber"),
            progressPercent: 53,
            rank: 4,
          },
        ],
        palette: {
          accentColor: "var(--primary)",
          accentSoft: "color-mix(in srgb, var(--primary) 18%, transparent)",
          accentText: "var(--primary)",
          trackColor: "color-mix(in srgb, var(--primary) 12%, #e4e4e7)",
        },
        visible: true,
      });
    }

    return allCards;
  }, [
    appointments,
    canSelectStaffScope,
    currentMonthEnd,
    currentMonthStart,
    currentRangeEnd,
    currentRangeStart,
    scopedStaffId,
    prevMonthStart,
    prevRangeEnd,
    prevRangeStart,
    hideEmployeeStatistics,
    hideStatistics,
    selectedStaffScope,
    t,
    user,
    waitlist,
    isStaffScopedDashboard,
  ]);

  if (!businessId) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("nav.dashboard")}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Please log in to view your performance dashboard.
        </p>
      </div>
    );
  }

  const visibleCards = cards.filter((card) => card.visible);
  const isLoadingFirstLoad =
    (appointments == null && appointmentsLoading) ||
    (!isStaffScopedDashboard && waitlist == null && waitlistLoading);
  const isBackgroundRefreshing =
    !isLoadingFirstLoad &&
    (appointmentsFetching || (!isStaffScopedDashboard && waitlistFetching) || staffScopeFetching);
  const selectableDays = Array.from({ length: currentDay }, (_, i) => i + 1);

  return (
    <main
      dir={dir}
      className="mx-auto w-full max-w-xl px-4 pt-4 pb-7 sm:px-5 sm:pt-5"
    >
      <header className="mb-4">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          {t("dashboard.kpiOverview")}
        </p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("dashboard.snapshot")}
          </h1>
          <BackgroundRefreshIndicator active={isBackgroundRefreshing} />
        </div>
      </header>

      <section className="mb-4 rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t("dashboard.rangeLabel")}
        </p>
        <div className={`grid gap-2 ${canSelectStaffScope ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"}`}>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("dashboard.fromDay")}
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={fromDay}
              onChange={(e) => setFromDay(Number(e.target.value))}
            >
              {selectableDays.map((d) => (
                <option key={`from-${d}`} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("dashboard.toDay")}
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={toDay}
              onChange={(e) => setToDay(Number(e.target.value))}
            >
              {selectableDays.map((d) => (
                <option key={`to-${d}`} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          {canSelectStaffScope ? (
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {t("dashboard.staffScopeLabel")}
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={selectedStaffScope}
                onChange={(e) => setSelectedStaffScope(e.target.value)}
              >
                <option value="all">{t("dashboard.staffScopeAll")}</option>
                {(staffScopeOptions ?? []).map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.firstName} {staff.lastName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        {isLoadingFirstLoad
          ? [1, 2, 3, 4].map((item) =>
              item === 4 && !isStaffScopedDashboard ? (
                <TeamGoalsCardSkeleton key={item} />
              ) : (
                <DashboardKpiCardSkeleton key={item} />
              ),
            )
          : visibleCards.map((card) =>
              isDashboardKpiTemplate(card) ? (
                <KpiTemplateCard
                  key={card.id}
                  card={card}
                  locale={locale}
                  isRtl={dir === "rtl"}
                  monthlyLabel={t("dashboard.monthlyKpi")}
                  noBaselineLabel={t("dashboard.noPreviousBaseline")}
                />
              ) : (
                <TeamGoalsProgressCard
                  key={card.id}
                  card={card}
                  isRtl={dir === "rtl"}
                  ownerLabel={t("role.owner")}
                  teamMemberLabel={t("dashboard.teamMember")}
                />
              ),
            )}
      </section>
    </main>
  );
}
