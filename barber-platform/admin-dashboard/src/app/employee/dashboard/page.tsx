"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useLocaleStore } from "@/stores/locale-store";
import { useEmployeeStaffId } from "@/hooks/use-employee-staff-id";
import { useTranslation } from "@/hooks/use-translation";
import { Calendar, Clock, DollarSign, Plus, UserCheck } from "lucide-react";
import Link from "next/link";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { DashboardPanelSkeleton, DashboardKpiCardSkeleton } from "@/components/ui/skeleton";
import { BackgroundRefreshIndicator } from "@/components/ui/background-refresh-indicator";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service: { name: string };
  customer: { firstName: string | null; lastName: string | null };
};

type AppointmentsResponse = {
  appointments: Appointment[];
  total: number;
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatTime(s: string) {
  return s.slice(11, 16);
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "greeting.morning";
  if (h < 17) return "greeting.afternoon";
  if (h < 21) return "greeting.evening";
  return "greeting.night";
}

export default function EmployeeDashboardPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const staffId = useEmployeeStaffId();
  const today = formatDate(new Date());

  const greetingBase = t(getGreeting());

  const {
    data: todayData,
    isLoading: todayLoading,
    isFetching: todayFetching,
  } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, staffId, today],
    queryFn: () =>
      apiClient(
        `/appointments?businessId=${businessId}&staffId=${staffId}&startDate=${today}&endDate=${today}&limit=50`
      ),
    enabled: !!businessId && !!staffId,
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endWeek = new Date();
  endWeek.setDate(endWeek.getDate() + 7);

  const {
    data: staffProfile,
    isLoading: profileLoading,
    isFetching: profileFetching,
  } = useQuery<{ firstName?: string; lastName?: string; avatarUrl?: string | null }>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    enabled: user?.role === "staff",
  });

  const displayName = staffProfile?.firstName
    || (user?.name ? user.name.split(/\s+/)[0] : null)
    || user?.email
    || user?.phone;
  const greeting = displayName ? `${greetingBase}, ${displayName}!` : `${greetingBase}!`;

  const {
    data: upcomingData,
    isLoading: upcomingLoading,
    isFetching: upcomingFetching,
  } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, staffId, "upcoming"],
    queryFn: () =>
      apiClient(
        `/appointments?businessId=${businessId}&staffId=${staffId}&startDate=${formatDate(tomorrow)}&endDate=${formatDate(endWeek)}&status=CONFIRMED&limit=20`
      ),
    enabled: !!businessId && !!staffId,
  });

  const todayAppointments = todayData?.appointments ?? [];
  const upcomingAppointments = upcomingData?.appointments ?? [];
  const completedToday = todayAppointments.filter((a) => a.status === "COMPLETED").length;
  const firstLoad =
    (todayData == null && todayLoading) ||
    (upcomingData == null && upcomingLoading) ||
    (staffProfile == null && profileLoading);
  const backgroundRefreshing =
    !firstLoad && (todayFetching || upcomingFetching || profileFetching);
  const nextAppointment = todayAppointments
    .filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  return (
    <div className="space-y-3 md:space-y-8">
      {/* Mobile layout */}
      <div className="md:hidden">
        <div className="greeting-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <StaffAvatar
              avatarUrl={staffProfile?.avatarUrl ?? null}
              firstName={staffProfile?.firstName ?? ""}
              lastName={staffProfile?.lastName ?? ""}
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
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold">{t("mobile.nextAppointment")}</h2>
          {nextAppointment ? (
            <Link
              href="/employee/appointments"
              className="block rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {nextAppointment.customer.firstName} {nextAppointment.customer.lastName}
                  </p>
                  <p className="text-sm text-zinc-500">{nextAppointment.service.name}</p>
                </div>
                <p className="font-medium">{formatTime(nextAppointment.startTime)}</p>
              </div>
            </Link>
          ) : (
            <p className="py-2 text-sm text-zinc-500">{t("mobile.noNextAppointment")}</p>
          )}
        </div>

        {/* Today's Schedule */}
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("mobile.todaysSchedule")}</h2>
            <Link href="/employee/appointments" className="text-xs text-blue-600 dark:text-blue-400">
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
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{todayAppointments.length}</p>
            <p className="text-xs text-zinc-500">{t("employee.todayAppointments")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{upcomingAppointments.length}</p>
            <p className="text-xs text-zinc-500">{t("employee.upcoming")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-lg font-bold">{completedToday}</p>
            <p className="text-xs text-zinc-500">{t("employee.completedToday")}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Link
            href="/employee/appointments"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Plus className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("mobile.newAppointment")}</span>
          </Link>
          <Link
            href="/employee/check-ins"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <UserCheck className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("employee.confirmArrived")}</span>
          </Link>
          <Link
            href="/employee/vacations"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Clock className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium">{t("mobile.blockTime")}</span>
          </Link>
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden md:block">
      <div className="greeting-card rounded-2xl p-6 shadow-md">
        <div className="flex items-center gap-4">
          <StaffAvatar
            avatarUrl={staffProfile?.avatarUrl ?? null}
            firstName={staffProfile?.firstName ?? ""}
            lastName={staffProfile?.lastName ?? ""}
            size="lg"
            className="shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
              <BackgroundRefreshIndicator active={backgroundRefreshing} />
            </div>
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

      <div className="grid gap-4 sm:grid-cols-3">
        {firstLoad ? (
          <>
            <DashboardKpiCardSkeleton />
            <DashboardKpiCardSkeleton />
            <DashboardKpiCardSkeleton />
          </>
        ) : (
          <>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
              <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.todayAppointments")}</p>
              <p className="text-2xl font-bold">{todayAppointments.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.upcoming")}</p>
              <p className="text-2xl font-bold">{upcomingAppointments.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
              <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.completedToday")}</p>
              <p className="text-2xl font-bold">{completedToday}</p>
            </div>
          </div>
        </div>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {firstLoad ? (
          <>
            <DashboardPanelSkeleton rows={5} />
            <DashboardPanelSkeleton rows={5} />
          </>
        ) : (
          <>
        <div className="min-h-[420px] rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-4 text-lg font-semibold">{t("employee.todayAppointments")}</h2>
          {todayAppointments.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">{t("employee.noAppointmentsToday")}</p>
          ) : (
            <ul className="space-y-3">
              {todayAppointments.map((apt) => (
                <li
                  key={apt.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
                >
                  <div>
                    <p className="font-medium">
                      {apt.customer.firstName} {apt.customer.lastName}
                    </p>
                    <p className="text-sm text-zinc-500">{apt.service.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatTime(apt.startTime)}</p>
                    <span
                      className={`text-xs rounded px-2 py-0.5 ${
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
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/employee/appointments"
            className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("employee.viewAllAppointments")} →
          </Link>
        </div>

        <div className="min-h-[420px] rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-4 text-lg font-semibold">{t("employee.upcoming")}</h2>
          {upcomingAppointments.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">{t("employee.noUpcoming")}</p>
          ) : (
            <ul className="space-y-3">
              {upcomingAppointments.slice(0, 5).map((apt) => (
                <li
                  key={apt.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
                >
                  <div>
                    <p className="font-medium">
                      {apt.customer.firstName} {apt.customer.lastName}
                    </p>
                    <p className="text-sm text-zinc-500">{apt.service.name}</p>
                  </div>
                  <p className="text-sm">
                    {formatDate(new Date(apt.startTime))} {formatTime(apt.startTime)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/employee/appointments"
            className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("employee.viewAll")} →
          </Link>
        </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
