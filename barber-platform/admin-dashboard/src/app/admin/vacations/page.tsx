"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useTranslation } from "@/hooks/use-translation";
import {
  Plane,
  Check,
  X,
  Trash2,
  Plus,
  Calendar,
  List,
  Users,
} from "lucide-react";
import { PrevArrow, NextArrow, DropdownArrow } from "@/components/ui/nav-arrow";
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
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(s: string, locale: string) {
  const d = new Date(`2000-01-01T${s}`);
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Consistent color per staff - same logic as appointments page */
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

function isVacationOnDate(v: TimeOffItem, date: Date): boolean {
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

export default function AdminVacationsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isManager = user?.role === "owner" || user?.role === "manager";

  const { data: staffMe } = useQuery<{ id: string; branchId?: string | null; firstName?: string; lastName?: string; avatarUrl?: string | null }>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    retry: false,
    enabled: !!businessId,
  });
  const selectedBranchId = useEffectiveBranchId(businessId);
  const operationalBranchId = selectedBranchId ?? staffMe?.branchId ?? null;

  const { data: branchStaff = [] } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ["staff", businessId, operationalBranchId, "excludeManagers"],
    queryFn: () =>
      apiClient(`/staff?businessId=${businessId}&branchId=${operationalBranchId || ""}&excludeManagers=true`),
    enabled: !!businessId && !!operationalBranchId && isManager,
  });
  const { data: modalStaffRaw = [] } = useQuery<
    { id: string; firstName: string; lastName: string; avatarUrl?: string | null }[]
  >({
    queryKey: ["staff", businessId, operationalBranchId ?? "all", "forModal"],
    queryFn: () =>
      apiClient(`/staff?businessId=${businessId}${operationalBranchId ? `&branchId=${operationalBranchId}` : ""}`),
    enabled: !!businessId,
  });
  const modalStaffList = useMemo(() => {
    const list = modalStaffRaw;
    if (staffMe && !list.some((s) => s.id === staffMe.id)) {
      return [
        { id: staffMe.id, firstName: staffMe.firstName ?? t("vacation.me"), lastName: staffMe.lastName ?? "", avatarUrl: staffMe.avatarUrl ?? null },
        ...list,
      ];
    }
    return list;
  }, [modalStaffRaw, staffMe, t]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string> | "all">(new Set());
  const [oneDayOnly, setOneDayOnly] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [message, setMessage] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const [statusFilters, setStatusFilters] = useState<Set<VacationStatus>>(
    () => new Set(STATUS_OPTIONS)
  );
  const [staffFilterId, setStaffFilterId] = useState<string | null>(null);
  const [staffDropdownOpen, setStaffDropdownOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("upcoming");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());


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
  const { data: vacations, isLoading } = useQuery<TimeOffItem[]>({
    queryKey: [
      "staff",
      "time-off",
      businessId,
      operationalBranchId,
      dateRange.start,
      dateRange.end,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        businessId: businessId || "",
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      if (operationalBranchId) params.set("branchId", operationalBranchId);
      return apiClient(`/staff/time-off?${params}`);
    },
    enabled: !!businessId,
  });

  const staffForFilter = useMemo(() => {
    const fromModal = new Map(modalStaffList.map((s) => [s.id, s]));
    for (const v of vacations ?? []) {
      if (!fromModal.has(v.staff.id)) {
        fromModal.set(v.staff.id, {
          id: v.staff.id,
          firstName: v.staff.firstName,
          lastName: v.staff.lastName,
          avatarUrl: v.staff.avatarUrl ?? null,
        });
      }
    }
    return Array.from(fromModal.values());
  }, [modalStaffList, vacations]);

  const filteredVacations = useMemo(() => {
    let list = vacations ?? [];
    if (statusFilters.size > 0) {
      list = list.filter((v) => statusFilters.has(v.status));
    }
    if (staffFilterId) {
      list = list.filter((v) => v.staff.id === staffFilterId);
    }
    // Apply date filter: upcoming = endDate >= tomorrow, past = endDate <= yesterday, today = includes today
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
  }, [vacations, statusFilters, staffFilterId, dateFilter, customStart, customEnd]);

  const requestedCount = (vacations ?? []).filter(
    (v) => v.status === "REQUESTED"
  ).length;
  const canAddMyVacation = !!staffMe?.id;

  const addMutation = useMutation({
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
  });

  const managerAddMutation = useMutation({
    mutationFn: (body: {
      staffId: string;
      businessId: string;
      startDate: string;
      endDate: string;
      isAllDay?: boolean;
      startTime?: string;
      endTime?: string;
    }) =>
      apiClient("/staff/time-off", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });

  const closeAddModal = () => {
    setShowAddModal(false);
    setSelectedStaffIds(new Set());
    setOneDayOnly(true);
    setStartDate("");
    setEndDate("");
    setMessage("");
  };

  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient(`/staff/time-off/${id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
      toast.success(t("vacation.approveSuccess"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient(`/staff/time-off/${id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
      toast.success(t("vacation.rejectSuccess"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient(`/staff/time-off/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
      toast.success(t("vacation.deleteSuccess"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  const handleAddModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveEnd = oneDayOnly ? startDate : endDate;
    if (!startDate || !effectiveEnd) return;
    if (new Date(effectiveEnd) < new Date(startDate)) {
      toast.error("End date must be after start date");
      return;
    }
    const staffIdsToAdd: string[] =
      selectedStaffIds === "all"
        ? modalStaffList.map((s) => s.id)
        : Array.from(selectedStaffIds);
    if (staffIdsToAdd.length === 0) {
      toast.error(t("vacation.selectStaff"));
      return;
    }
    const body = {
      startDate,
      endDate: effectiveEnd,
      isAllDay: allDay,
      ...(allDay ? {} : { startTime, endTime }),
    };
    setIsSubmittingAdd(true);
    try {
      for (const staffId of staffIdsToAdd) {
        if (staffId === staffMe?.id) {
          await addMutation.mutateAsync(body);
        } else if (businessId) {
          await managerAddMutation.mutateAsync({ ...body, staffId, businessId });
        }
      }
      closeAddModal();
      toast.success(t("vacation.addSuccess"));
      queryClient.invalidateQueries({ queryKey: ["staff", "time-off"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  const toggleStaffSelection = (id: string) => {
    setSelectedStaffIds((prev) => {
      if (prev === "all") return new Set(modalStaffList.map((s) => s.id).filter((x) => x !== id));
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSelectAll = () => {
    setSelectedStaffIds("all");
  };

  const isStaffSelected = (id: string) =>
    selectedStaffIds === "all" || selectedStaffIds.has(id);

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
      <div>
        <h1 className="text-2xl font-semibold">{t("vacation.managementTitle")}</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          {t("vacation.managementSubtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {canAddMyVacation && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Plus className="h-4 w-4" />
            {t("vacation.addMyVacation")}
          </button>
        )}
      </div>

      {/* Add Vacation Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            dir="rtl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t("vacation.addVacation")}
              </h2>
              <button
                type="button"
                onClick={closeAddModal}
                className="rounded p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              {t("vacation.markEmployees")}
            </p>

            <form onSubmit={handleAddModalSubmit} className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  {t("vacation.selectStaff")}
                </label>
                <div className="flex flex-wrap gap-4">
                  {modalStaffList.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStaffSelection(s.id)}
                      className={`flex flex-col items-center gap-1.5 rounded-full p-1 transition-all ${
                        isStaffSelected(s.id)
                          ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-white dark:ring-offset-zinc-900"
                          : "ring-1 ring-zinc-300 hover:ring-zinc-400 dark:ring-zinc-600 dark:hover:ring-zinc-500"
                      }`}
                    >
                      <StaffAvatar
                        avatarUrl={s.avatarUrl ?? null}
                        firstName={s.firstName ?? ""}
                        lastName={s.lastName ?? ""}
                        size="lg"
                        className="h-14 w-14"
                      />
                      <span className="max-w-16 truncate text-xs">
                        {s.id === staffMe?.id ? t("vacation.me") : `${s.firstName} ${s.lastName}`}
                      </span>
                    </button>
                  ))}
                  {isManager && modalStaffList.length > 1 && (
                    <button
                      type="button"
                      onClick={setSelectAll}
                      className={`flex flex-col items-center gap-1.5 rounded-full p-1 transition-all ${
                        selectedStaffIds === "all"
                          ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-white dark:ring-offset-zinc-900"
                          : "ring-1 ring-zinc-300 hover:ring-zinc-400 dark:ring-zinc-600 dark:hover:ring-zinc-500"
                      }`}
                    >
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <Users className="h-7 w-7 text-zinc-500 dark:text-zinc-400" />
                      </div>
                      <span className="max-w-16 truncate text-xs">
                        {t("vacation.selectAll")}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <label className="mb-2 block text-sm font-medium">
                  {t("vacation.fromDate")}
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  required
                />
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {t("vacation.oneDayOrMore")}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOneDayOnly(true)}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      oneDayOnly
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {t("vacation.oneDay")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOneDayOnly(false)}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      !oneDayOnly
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {t("vacation.more")}
                  </button>
                </div>
                {!oneDayOnly && (
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    required={!oneDayOnly}
                  />
                )}
              </div>

              <div>
                <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {t("vacation.messageHint")}
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("vacation.messagePlaceholder")}
                  rows={3}
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 placeholder-zinc-500 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>

              <div className="flex justify-center pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="btn-primary w-full rounded-xl px-6 py-3 font-medium transition-colors disabled:opacity-50"
                >
                  {isSubmittingAdd ? t("widget.loading") : t("vacation.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-semibold">{t("vacation.allTeamVacations")}</h2>

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
            {requestedCount > 0 && (
              <span className="text-sm text-amber-600 dark:text-amber-400">
                ({t("vacation.pendingApproval")}: {requestedCount})
              </span>
            )}
          </div>
          <div className="relative">
            <span className="mr-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("vacation.filters.employee")}:
            </span>
            <button
              type="button"
              onClick={() => setStaffDropdownOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {staffFilterId ? (() => {
                const sel = staffForFilter.find((s) => s.id === staffFilterId);
                return sel ? (
                  <>
                    <StaffAvatar
                      avatarUrl={sel.avatarUrl ?? null}
                      firstName={sel.firstName ?? ""}
                      lastName={sel.lastName ?? ""}
                      size="sm"
                    />
                    <span>{sel.id === staffMe?.id ? t("vacation.me") : `${sel.firstName} ${sel.lastName}`}</span>
                  </>
                ) : (
                  <span>{t("vacation.filters.allEmployees")}</span>
                );
              })() : (
                <>
                  <Users className="h-4 w-4 text-zinc-500" />
                  <span>{t("vacation.filters.allEmployees")}</span>
                </>
              )}
              <DropdownArrow className="h-4 w-4 text-zinc-500" />
            </button>
            {staffDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setStaffDropdownOpen(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg rtl:left-auto rtl:right-0 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      setStaffFilterId(null);
                      setStaffDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 ${
                      !staffFilterId ? "bg-zinc-50 dark:bg-zinc-700" : ""
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0 text-zinc-500" />
                    {t("vacation.filters.allEmployees")}
                  </button>
                  {staffForFilter.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setStaffFilterId(s.id);
                        setStaffDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 ${
                        staffFilterId === s.id ? "bg-zinc-50 dark:bg-zinc-700" : ""
                      }`}
                    >
                      <StaffAvatar
                        avatarUrl={s.avatarUrl ?? null}
                        firstName={s.firstName ?? ""}
                        lastName={s.lastName ?? ""}
                        size="sm"
                      />
                      <span>{s.id === staffMe?.id ? t("vacation.me") : `${s.firstName} ${s.lastName}`}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("vacation.filters.date")}:
            </span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
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
                  className="min-h-11 rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <span className="text-zinc-500">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="min-h-11 rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
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

        {isLoading ? (
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
                        <span className="ms-1">
                          {formatTime(v.startTime, locale)}–{formatTime(v.endTime, locale)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={v.status} />
                  {isManager && v.status === "REQUESTED" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate({ id: v.id })}
                        disabled={approveMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        {t("vacation.approve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectMutation.mutate({ id: v.id })}
                        disabled={rejectMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <X className="h-4 w-4" />
                        {t("vacation.reject")}
                      </button>
                    </div>
                  )}
                  {isManager &&
                    (v.status === "APPROVED" || v.status === "REJECTED") && (
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate({ id: v.id })}
                        disabled={deleteMutation.isPending}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-700 dark:hover:text-red-400"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                </div>
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
