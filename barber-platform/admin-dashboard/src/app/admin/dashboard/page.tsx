"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { InsightsPanel } from "@/components/ui/insights-panel";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { DashboardCardSkeleton, ChartSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { AppointmentsTrendChart } from "@/components/charts/appointments-trend-chart";
import { CustomersGrowthChart } from "@/components/charts/customers-growth-chart";
import { StaffPerformanceChart } from "@/components/charts/staff-performance-chart";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchStore } from "@/stores/branch-store";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import {
  Calendar,
  Users,
  DollarSign,
  UsersRound,
  Gift,
  Plus,
  UserPlus,
  Clock,
} from "lucide-react";
import { StaffAvatar } from "@/components/ui/staff-avatar";

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function formatTime(s: string) {
  return s.slice(11, 16);
}

type AppointmentItem = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service: { name: string };
  customer: { firstName: string | null; lastName: string | null };
  staff?: { firstName: string; lastName: string };
};

type DashboardData = {
  customerGrowth: { date: string; count: number }[];
  appointmentsGraph: { date: string; count: number }[];
  waitlistToday: { count: number };
  todayMetrics?: {
    appointmentsToday: number;
    customersToday: number;
    revenueToday: number;
    waitlistSize: number;
  };
  visitMetrics?: {
    returningCustomers: number;
    avgVisitsPerCustomer: number;
    customerRetentionRate: number;
  };
  staffPerformance: Array<{
    staffId: string;
    staffName: string;
    totalBookings: number;
    completedBookings: number;
    revenue: number;
    completionRate: number;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    staffName?: string;
    customerName: string;
    serviceName?: string;
    startTime?: string;
    createdAt: string;
  }>;
  todaysBirthdays?: Array<{ id: string; name: string; type: string }>;
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "greeting.morning";
  if (h < 17) return "greeting.afternoon";
  if (h < 21) return "greeting.evening";
  return "greeting.night";
}

export default function AdminDashboardPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const branchId = useBranchStore((s) => s.selectedBranchId);

  const { data, isLoading, isError, error } = useQuery<DashboardData>({
    queryKey: ["dashboard", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<DashboardData>(
        `/analytics/dashboard?businessId=${businessId}${branchId ? `&branchId=${branchId}` : ""}`
      ),
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: profileStaff } = useQuery<{
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
  }>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    retry: false,
    enabled: !!businessId && !!(user?.staffId || user?.businessId),
  });

  const { data: waitlistItems } = useQuery({
    queryKey: ["waitlist", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<Array<{ id: string; customer?: { firstName?: string; lastName?: string; email: string }; service?: { name: string }; createdAt: string }>>(
        `/waitlist?businessId=${businessId}&status=ACTIVE${branchId ? `&branchId=${branchId}` : ""}&limit=10`
      ),
    enabled: !!businessId,
    staleTime: 1 * 60 * 1000,
  });

  const todayStr = formatDate(new Date());
  const { data: todayAppointmentsData } = useQuery<{ appointments: AppointmentItem[] }>({
    queryKey: ["appointments", "today", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient(
        `/appointments?businessId=${businessId}&startDate=${todayStr}&endDate=${todayStr}&limit=50${branchId ? `&branchId=${branchId}` : ""}`
      ),
    enabled: !!businessId,
    staleTime: 1 * 60 * 1000,
  });
  const todayAppointments = todayAppointmentsData?.appointments ?? [];
  const nextAppointment = todayAppointments
    .filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  const [appointmentsFilter, setAppointmentsFilter] = useState<"day" | "week" | "month">("week");
  const [customersFilter, setCustomersFilter] = useState<"day" | "week" | "month">("week");

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view the dashboard.
        </p>
      </div>
    );
  }

  const greetingBase = t(getGreeting());
  const userName = profileStaff?.firstName
    || (user?.name ? user.name.split(/\s+/)[0] : null)
    || user?.email
    || user?.phone;
  const greeting = userName ? `${greetingBase}, ${userName}!` : `${greetingBase}!`;
  const today = data?.todayMetrics;
  const waitlistCount = today?.waitlistSize ?? data?.waitlistToday?.count ?? 0;

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">Unable to load dashboard</p>
          <p className="mt-1 text-sm">{error instanceof Error ? error.message : "Please try again later."}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex gap-0">
        <div className="min-w-0 flex-1 space-y-8 p-6">
          <div className="greeting-card h-24 animate-pulse rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <DashboardCardSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <ChartSkeleton />
            <ChartSkeleton />
            <TableSkeleton rows={3} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0">
      {/* Mobile layout - only on small screens */}
      <div className="min-w-0 flex-1 space-y-3 md:hidden">
        {/* Compact greeting */}
        <div className="greeting-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <StaffAvatar
              avatarUrl={profileStaff?.avatarUrl ?? null}
              firstName={profileStaff?.firstName ?? ""}
              lastName={profileStaff?.lastName ?? ""}
              size="md"
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold">{greeting}</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        </div>

        {/* Next Appointment */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold">{t("mobile.nextAppointment")}</h2>
          {nextAppointment ? (
            <Link
              href="/admin/appointments"
              className="block rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {nextAppointment.customer.firstName} {nextAppointment.customer.lastName}
                  </p>
                  <p className="text-sm text-zinc-500">{nextAppointment.service.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatTime(nextAppointment.startTime)}</p>
                  {nextAppointment.staff && (
                    <p className="text-xs text-zinc-500">
                      {nextAppointment.staff.firstName} {nextAppointment.staff.lastName}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ) : (
            <p className="py-2 text-sm text-zinc-500">{t("mobile.noNextAppointment")}</p>
          )}
        </div>

        {/* Today's Schedule timeline */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("mobile.todaysSchedule")}</h2>
            <Link href="/admin/appointments" className="text-xs text-blue-600 dark:text-blue-400">
              {t("employee.viewAll")}
            </Link>
          </div>
          {todayAppointments.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">{t("employee.noAppointmentsToday")}</p>
          ) : (
            <ul className="space-y-2">
              {todayAppointments.slice(0, 5).map((apt) => (
                <li
                  key={apt.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-100 p-2.5 dark:border-zinc-700"
                >
                  <span className="text-sm font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatTime(apt.startTime)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {apt.customer.firstName} {apt.customer.lastName}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{apt.service.name}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                      apt.status === "COMPLETED"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : apt.status === "CONFIRMED" || apt.status === "IN_PROGRESS"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        : "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {apt.status === "COMPLETED"
                      ? t("appointments.statusCompleted")
                      : apt.status === "CONFIRMED" || apt.status === "IN_PROGRESS"
                      ? t("appointments.statusConfirmed")
                      : apt.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Compact stats row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{today?.appointmentsToday ?? 0}</p>
            <p className="text-xs text-zinc-500">{t("metrics.appointmentsToday")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{today?.customersToday ?? 0}</p>
            <p className="text-xs text-zinc-500">{t("metrics.customersToday")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">${(today?.revenueToday ?? 0).toFixed(0)}</p>
            <p className="text-xs text-zinc-500">{t("metrics.revenueToday")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{waitlistCount}</p>
            <p className="text-xs text-zinc-500">{t("metrics.waitlistSize")}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          <Link
            href="/admin/appointments"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Plus className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("mobile.newAppointment")}</span>
          </Link>
          <Link
            href="/admin/customers"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <UserPlus className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("mobile.addCustomer")}</span>
          </Link>
          <Link
            href="/admin/appointments"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Clock className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("mobile.blockTime")}</span>
          </Link>
        </div>
      </div>

      {/* Desktop layout - unchanged */}
      <div className="hidden min-w-0 flex-1 space-y-8 p-6 md:block">
      {/* Greeting with gradient */}
      <div className="greeting-card rounded-2xl p-6 shadow-md">
        <div className="flex items-center gap-4">
          <StaffAvatar
            avatarUrl={profileStaff?.avatarUrl ?? null}
            firstName={profileStaff?.firstName ?? ""}
            lastName={profileStaff?.lastName ?? ""}
            size="lg"
            className="shrink-0"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          {new Date().toLocaleDateString(locale, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
            </p>
          </div>
        </div>
      </div>

      {/* Key metrics cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard
          icon={<Calendar className="h-5 w-5" />}
          title={t("metrics.appointmentsToday")}
          value={today?.appointmentsToday ?? 0}
          gradient
        />
        <DashboardCard
          icon={<Users className="h-5 w-5" />}
          title={t("metrics.customersToday")}
          value={today?.customersToday ?? 0}
        />
        <DashboardCard
          icon={<DollarSign className="h-5 w-5" />}
          title={t("metrics.revenueToday")}
          value={`$${(today?.revenueToday ?? 0).toFixed(2)}`}
        />
        <DashboardCard
          icon={<UsersRound className="h-5 w-5" />}
          title={t("metrics.waitlistSize")}
          value={waitlistCount}
        />
      </div>

      {/* Graphs row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AppointmentsTrendChart
          data={data?.appointmentsGraph ?? []}
          timeFilter={appointmentsFilter}
          onTimeFilterChange={setAppointmentsFilter}
        />
        <CustomersGrowthChart
          data={data?.customerGrowth ?? []}
          timeFilter={customersFilter}
          onTimeFilterChange={setCustomersFilter}
        />
      </div>

      {/* Staff performance chart + Activity feed + Birthdays */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StaffPerformanceChart data={data?.staffPerformance ?? []} />
        </div>

        {/* Right column: Activity + Birthdays */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:scale-[1.01] hover:shadow-lg dark:border-zinc-700/80 dark:bg-zinc-900/50">
            <h2 className="mb-4 font-semibold">{t("widget.recentActivity")}</h2>
            {data?.recentActivity?.length ? (
              <ul className="max-h-64 space-y-3 overflow-y-auto">
                {data.recentActivity.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <span
                      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                        a.type === "booking"
                          ? "bg-emerald-500"
                          : a.type === "cancellation"
                          ? "bg-amber-500"
                          : a.type === "no_show"
                          ? "bg-red-500"
                          : "bg-blue-500"
                      }`}
                    />
                    <div>
                      {a.type === "customer_registered" ? (
                        <span>
                          {t("activity.customerRegistered")}: {a.customerName}
                        </span>
                      ) : (
                        <span>
                          {a.staffName} · {a.customerName}
                          {a.serviceName && ` · ${a.serviceName}`}
                        </span>
                      )}
                      <p className="text-xs text-zinc-500">
                        {new Date(a.createdAt).toLocaleString(locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-500">
                {t("widget.noData")}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:scale-[1.01] hover:shadow-lg dark:border-zinc-700/80 dark:bg-zinc-900/50">
            <div className="mb-4 flex items-center gap-2">
              <Gift className="h-5 w-5 text-zinc-500" />
              <h2 className="font-semibold">{t("widget.todaysBirthdays")}</h2>
            </div>
            {data?.todaysBirthdays?.length ? (
              <ul className="space-y-2">
                {data.todaysBirthdays.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                      {b.name}
                    </span>
                    <a
                      href={`/admin/customers/${b.id}`}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-zinc-500">
                No birthdays today
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Visit metrics + Waitlist table */}
      <div className="grid gap-6 lg:grid-cols-3">
        {data?.visitMetrics && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:shadow-lg dark:border-zinc-700/80 dark:bg-zinc-900/50">
            <h2 className="mb-4 font-semibold">Visit metrics</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {t("widget.returningCustomers")}
                </span>
                <span className="font-medium">
                  {data.visitMetrics.returningCustomers ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {t("widget.avgVisitsPerCustomer")}
                </span>
                <span className="font-medium">
                  {(data.visitMetrics.avgVisitsPerCustomer ?? 0).toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {t("widget.customerRetentionRate")}
                </span>
                <span className="font-medium">
                  {data.visitMetrics.customerRetentionRate ?? 0}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Waitlist today table */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:shadow-lg dark:border-zinc-700/80 dark:bg-zinc-900/50 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{t("widget.waitlistToday")}</h2>
            <a
              href="/admin/waitlist"
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              View all
            </a>
          </div>
          {waitlistItems && waitlistItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <th className="pb-2 text-left font-medium">Customer</th>
                    <th className="pb-2 text-left font-medium">Service</th>
                    <th className="pb-2 text-left font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlistItems.slice(0, 5).map((w) => (
                    <tr key={w.id} className="border-b border-zinc-100 transition-colors duration-200 hover:bg-zinc-50 dark:border-zinc-700/50 dark:hover:bg-zinc-800/50">
                      <td className="py-2">
                        {[w.customer?.firstName, w.customer?.lastName].filter(Boolean).join(" ") || w.customer?.email || "—"}
                      </td>
                      <td className="py-2 text-zinc-600 dark:text-zinc-400">
                        {w.service?.name ?? "—"}
                      </td>
                      <td className="py-2 text-zinc-500">
                        {new Date(w.createdAt).toLocaleDateString(locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-zinc-500">
              {waitlistCount} active {waitlistCount === 1 ? "entry" : "entries"}.{" "}
              <a href="/admin/waitlist" className="text-blue-600 hover:underline dark:text-blue-400">
                View waitlist
              </a>
            </p>
          )}
        </div>
      </div>
      </div>
      <div className="hidden md:block">
      <InsightsPanel defaultOpen={false}>
        <div className="space-y-4 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">
            Quick insights and tips appear here.
          </p>
          {data?.visitMetrics && (
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="font-medium">Retention</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {data.visitMetrics.customerRetentionRate ?? 0}% of customers return
              </p>
            </div>
          )}
        </div>
      </InsightsPanel>
      </div>
    </div>
  );
}

