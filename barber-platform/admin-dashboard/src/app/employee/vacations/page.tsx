"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEmployeeStaffId } from "@/hooks/use-employee-staff-id";
import { useTranslation } from "@/hooks/use-translation";
import { Plane, Plus, X, Calendar, List } from "lucide-react";
import { PrevArrow, NextArrow } from "@/components/ui/nav-arrow";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { useLocaleStore } from "@/stores/locale-store";
import toast from "react-hot-toast";

type TimeOffItem = {
  id: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
  isAllDay: boolean;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";
};

type StaffProfile = {
  id: string;
  branchId?: string | null;
  staffTimeOff?: TimeOffItem[];
};

type TeamVacation = TimeOffItem & {
  staff: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
};

type VacationStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";
type DateFilter = "today" | "upcoming" | "past" | "custom";

const STATUS_OPTIONS: VacationStatus[] = [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];
type ViewMode = "calendar" | "list";

function formatDate(s: string, locale: string) {
  return new Date(s).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STAFF_COLOR_PALETTE = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
];

function getStaffColor(staffId: string | undefined): string {
  if (!staffId) return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
  let hash = 0;
  for (let i = 0; i < staffId.length; i++) hash = (hash << 5) - hash + staffId.charCodeAt(i);
  const idx = Math.abs(hash) % STAFF_COLOR_PALETTE.length;
  return STAFF_COLOR_PALETTE[idx];
}

function formatTime(s: string) {
  return s.slice(0, 5);
}

function StatusBadge({ status }: { status: TimeOffItem["status"] }) {
  const t = useTranslation();
  const map: Record<TimeOffItem["status"], string> = {
    REQUESTED: "vacation.statusRequested",
    APPROVED: "vacation.statusApproved",
    REJECTED: "vacation.statusRejected",
    CANCELLED: "vacation.statusCancelled",
  };
  const colors: Record<TimeOffItem["status"], string> = {
    REQUESTED: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}
    >
      {t(map[status])}
    </span>
  );
}

function isVacationOnDate(v: TeamVacation, date: Date): boolean {
  const d = toLocalDateStr(date);
  const vs = v.startDate.slice(0, 10);
  const ve = v.endDate.slice(0, 10);
  return vs <= d && ve >= d;
}

function getDateRangeForFilter(
  dateFilter: DateFilter,
  customStart?: string,
  customEnd?: string
): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  const oneYearLaterStr = oneYearLater.toISOString().slice(0, 10);

  switch (dateFilter) {
    case "today":
      return { start: todayStr, end: todayStr };
    case "upcoming":
      return { start: tomorrowStr, end: oneYearLaterStr };
    case "past":
      return { start: oneYearAgoStr, end: yesterdayStr };
    case "custom":
      return {
        start: customStart || todayStr,
        end: customEnd || oneYearLaterStr,
      };
    default:
      return { start: oneYearAgoStr, end: oneYearLaterStr };
  }
}

export default function EmployeeVacationsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const queryClient = useQueryClient();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const staffId = useEmployeeStaffId();
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const [statusFilters, setStatusFilters] = useState<Set<VacationStatus>>(
    () => new Set(STATUS_OPTIONS)
  );
  const [dateFilter, setDateFilter] = useState<DateFilter>("upcoming");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  const { data: staff, isLoading } = useQuery<StaffProfile>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    enabled: !!staffId,
  });
  const employeeBranchId = staff?.branchId ?? null;

  const baseDateRange = getDateRangeForFilter(dateFilter, customStart, customEnd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  const needsWideRange =
    statusFilters.has("REQUESTED") ||
    statusFilters.has("CANCELLED") ||
    viewMode === "calendar";
  const dateRange = needsWideRange
    ? {
        start: oneYearAgo.toISOString().slice(0, 10),
        end: oneYearLater.toISOString().slice(0, 10),
      }
    : baseDateRange;
  const { data: teamVacations, isLoading: loadingVacations } = useQuery<
    TeamVacation[]
  >({
    queryKey: [
      "staff",
      "time-off",
      businessId,
      employeeBranchId,
      dateRange.start,
      dateRange.end,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        businessId: businessId || "",
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      if (employeeBranchId) params.set("branchId", employeeBranchId);
      return apiClient(`/staff/time-off?${params}`);
    },
    enabled: !!businessId,
  });

  const requestMutation = useMutation({
    mutationFn: (body: {
      startDate: string;
      endDate: string;
      isAllDay?: boolean;
      startTime?: string;
      endTime?: string;
    }) =>
      apiClient("/staff/me/time-off", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
      setShowForm(false);
      setStartDate("");
      setEndDate("");
      toast.success(t("vacation.addSuccess"));
    },
    onError: (e: Error) => toast.error(e.message || "Request failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/staff/me/time-off/${id}/cancel`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
      toast.success(t("vacation.cancelSuccess"));
    },
    onError: (e: Error) => toast.error(e.message || "Cancel failed"),
  });

  const filteredVacations = useMemo(() => {
    let list = teamVacations ?? [];
    if (statusFilters.size > 0) {
      list = list.filter((v) => statusFilters.has(v.status));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toLocalDateStr(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toLocalDateStr(tomorrow);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yesterday);
    if (dateFilter === "upcoming") {
      list = list.filter((v) => v.endDate.slice(0, 10) >= tomorrowStr);
    } else if (dateFilter === "past") {
      list = list.filter((v) => v.endDate.slice(0, 10) <= yesterdayStr);
    } else if (dateFilter === "today") {
      list = list.filter((v) => {
        const vs = v.startDate.slice(0, 10);
        const ve = v.endDate.slice(0, 10);
        return vs <= todayStr && ve >= todayStr;
      });
    } else if (dateFilter === "custom" && customStart && customEnd) {
      list = list.filter((v) => {
        const vs = v.startDate.slice(0, 10);
        const ve = v.endDate.slice(0, 10);
        return vs <= customEnd && ve >= customStart;
      });
    }
    return list;
  }, [teamVacations, statusFilters, dateFilter, customStart, customEnd]);

  const timeOff = staff?.staffTimeOff ?? [];
  const activeTimeOff = timeOff.filter((t) => t.status !== "CANCELLED");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    if (new Date(endDate) < new Date(startDate)) {
      toast.error("End date must be after start date");
      return;
    }
    requestMutation.mutate({
      startDate,
      endDate,
      isAllDay: allDay,
      ...(allDay ? {} : { startTime, endTime }),
    });
  };

  const weekDays = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    new Date(2024, 0, 7 + d).toLocaleDateString(locale, { weekday: "short" })
  );
  const monthStart = new Date(
    calendarMonth.getFullYear(),
    calendarMonth.getMonth(),
    1
  );
  const monthEnd = new Date(
    calendarMonth.getFullYear(),
    calendarMonth.getMonth() + 1,
    0
  );
  const startPad = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();
  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d)
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("vacation.title")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {t("employee.vacationSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? t("vacation.close") : t("employee.requestVacation")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("vacation.startDate")}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("vacation.endDate")}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                required
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              <span className="text-sm">{t("vacation.allDay")}</span>
            </label>
          </div>
          {!allDay && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("vacation.specificHours")} (start)
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("vacation.specificHours")} (end)
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
            </div>
          )}
          <div className="mt-6 flex gap-2">
            <button
              type="submit"
              disabled={requestMutation.isPending}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
            >
              {requestMutation.isPending
                ? t("widget.loading")
                : t("vacation.submitRequest")}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
            >
              {t("vacation.cancel")}
            </button>
          </div>
        </form>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t("vacation.myVacations")}</h2>
        {isLoading ? (
          <p className="text-zinc-500">{t("widget.loading")}</p>
        ) : activeTimeOff.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-8 dark:border-zinc-600">
            <Plane className="mb-3 h-10 w-10 text-zinc-400" />
            <p className="text-sm text-zinc-500">
              {t("employee.noVacationScheduled")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTimeOff.map((to) => (
              <div
                key={to.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <p className="text-sm font-medium">
                  {formatDate(to.startDate, locale)} – {formatDate(to.endDate, locale)}
                  {!to.isAllDay && to.startTime && to.endTime && (
                    <span className="ml-2 text-zinc-500">
                      {formatTime(to.startTime)} – {formatTime(to.endTime)}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <StatusBadge status={to.status} />
                  {to.status === "REQUESTED" && (
                    <button
                      type="button"
                      onClick={() => cancelMutation.mutate(to.id)}
                      disabled={cancelMutation.isPending}
                      className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      {t("vacation.cancelRequest")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Calendar className="h-5 w-5" />
          {t("employee.teamVacationCalendar")}
        </h2>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("vacation.filters.status")}:
            </span>
            <div className="flex flex-wrap items-center gap-4">
              {STATUS_OPTIONS.map((status) => (
                <label
                  key={status}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={statusFilters.has(status)}
                    onChange={() => {
                      setStatusFilters((prev) => {
                        const next = new Set(prev);
                        if (next.has(status)) next.delete(status);
                        else next.add(status);
                        return next;
                      });
                    }}
                  />
                  {t(
                    status === "REQUESTED"
                      ? "vacation.statusRequested"
                      : status === "APPROVED"
                        ? "vacation.statusApproved"
                        : status === "REJECTED"
                          ? "vacation.statusRejected"
                          : "vacation.statusCancelled"
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("vacation.filters.date")}:
            </span>
            <select
              value={dateFilter}
              onChange={(e) =>
                setDateFilter(e.target.value as DateFilter)
              }
              className="min-h-11 rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="today">{t("vacation.filters.today")}</option>
              <option value="upcoming">{t("vacation.filters.upcoming")}</option>
              <option value="past">{t("vacation.filters.past")}</option>
              <option value="custom">{t("vacation.filters.custom")}</option>
            </select>
            {dateFilter === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="min-h-11 rounded-xl border-2 border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <span className="text-zinc-500">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="min-h-11 rounded-xl border-2 border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            )}
          </div>
          <div className="ml-auto flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                viewMode === "calendar"
                  ? "bg-zinc-200 dark:bg-zinc-700"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Calendar className="inline h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                viewMode === "list"
                  ? "bg-zinc-200 dark:bg-zinc-700"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <List className="inline h-4 w-4" />
            </button>
          </div>
        </div>

        {loadingVacations ? (
          <p className="rounded-xl border border-zinc-200 bg-white p-6 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800">
            {t("widget.loading")}
          </p>
        ) : filteredVacations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 dark:border-zinc-700 dark:bg-zinc-800">
            <Plane className="mb-4 h-12 w-12 text-zinc-400" />
            <p className="text-zinc-500">{t("vacation.empty")}</p>
          </div>
        ) : viewMode === "list" ? (
          <div className="space-y-2">
            {filteredVacations.map((v) => {
              const todayStr = toLocalDateStr(new Date());
              const isTodayVacation =
                v.startDate.slice(0, 10) <= todayStr && v.endDate.slice(0, 10) >= todayStr;
              return (
                <div
                  key={v.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 dark:border-zinc-700 dark:bg-zinc-800 ${
                    isTodayVacation
                      ? "border-amber-500 bg-amber-50/80 ring-2 ring-amber-400/50 dark:bg-amber-900/20 dark:ring-amber-500/30"
                      : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <StaffAvatar
                      avatarUrl={v.staff.avatarUrl ?? null}
                      firstName={v.staff.firstName ?? ""}
                      lastName={v.staff.lastName ?? ""}
                      size="md"
                    />
                    <div>
                      <p className="font-medium">
                        {v.staff.firstName} {v.staff.lastName}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {formatDate(v.startDate, locale)} – {formatDate(v.endDate, locale)}
                        {!v.isAllDay && v.startTime && v.endTime && (
                          <span className="ml-1">
                            {formatTime(v.startTime)}–{formatTime(v.endTime)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() - 1
                    )
                  )
                }
                className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <PrevArrow className="h-5 w-5" />
              </button>
              <h3 className="font-semibold">
                {calendarMonth.toLocaleDateString(locale, {
                  month: "long",
                  year: "numeric",
                })}
              </h3>
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() + 1
                    )
                  )
                }
                className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <NextArrow className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500">
              {weekDays.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {calendarDays.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} />;
                const dayStr = toLocalDateStr(day);
                const vacationsOnDay = filteredVacations.filter((v) =>
                  isVacationOnDate(v, day)
                );
                const isToday = dayStr === toLocalDateStr(new Date());
                return (
                  <div
                    key={dayStr}
                    className={`min-h-[5rem] rounded-lg border p-2 ${
                      isToday
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <div className="text-right text-sm font-medium">
                      {day.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {vacationsOnDay.slice(0, 3).map((v) => {
                        const isTodayVacation = isVacationOnDate(v, new Date());
                        const staffColor = getStaffColor(v.staff.id);
                        return (
                          <div
                            key={v.id}
                            className={`flex items-center gap-1 truncate rounded px-2 py-1 text-xs ${staffColor} ${
                              isTodayVacation ? "ring-1 ring-amber-500 dark:ring-amber-400" : ""
                            }`}
                            title={`${v.staff.firstName} ${v.staff.lastName}`}
                          >
                            <StaffAvatar
                              avatarUrl={v.staff.avatarUrl ?? null}
                              firstName={v.staff.firstName}
                              lastName={v.staff.lastName}
                              size="sm"
                              className="h-5 w-5 shrink-0 text-[8px]"
                            />
                            {v.staff.firstName}
                          </div>
                        );
                      })}
                      {vacationsOnDay.length > 3 && (
                        <div className="text-xs text-zinc-500">
                          +{vacationsOnDay.length - 3}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
