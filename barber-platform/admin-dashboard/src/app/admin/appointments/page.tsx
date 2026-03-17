"use client";

import dynamic from "next/dynamic";
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchStore } from "@/stores/branch-store";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import toast from "react-hot-toast";
import { PrevArrow, NextArrow } from "@/components/ui/nav-arrow";
import {
  Plus,
  Calendar,
  User,
  Scissors,
  Clock,
} from "lucide-react";
import { AppointmentCalendarSkeleton } from "@/components/ui/skeleton";
import { LoadingButton } from "@/components/ui/loading-button";
import { StaffAvatar } from "@/components/ui/staff-avatar";
const AppointmentFullCalendar = dynamic(
  () => import("@/components/appointments/appointment-fullcalendar").then((m) => m.AppointmentFullCalendar),
  { ssr: false, loading: () => <AppointmentCalendarSkeleton /> }
);
import { StaffSelector } from "@/components/appointments/staff-selector";
import { AppointmentPopup } from "@/components/appointments/appointment-popup";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff: { id: string; firstName: string; lastName: string };
  service: { id: string; name: string; durationMinutes: number };
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
  };
  branch?: { id: string; name: string } | null;
};

type AppointmentsResponse = {
  appointments: Appointment[];
  total: number;
  page: number;
  limit: number;
};

type AvailabilityResult = {
  date: string;
  staffId: string;
  staffName: string;
  serviceId?: string;
  slots: string[];
};

type TimeOffItem = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  staff: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
};

/** Consistent color per staff - hash staffId to pick from palette */
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

const STATUS_OPTIONS = [
  { value: "", labelKey: "appointments.statusAll" },
  { value: "CONFIRMED", labelKey: "appointments.statusConfirmed" },
  { value: "COMPLETED", labelKey: "appointments.statusCompleted" },
  { value: "CANCELLED", labelKey: "appointments.statusCancelled" },
  { value: "NO_SHOW", labelKey: "appointments.statusNoShow" },
];

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekRange(d: Date) {
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function getMonthRange(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end };
}

function getMonthDays(d: Date) {
  const { start, end } = getMonthRange(d);
  const startDay = start.getDay();
  const startPad = new Date(start);
  startPad.setDate(start.getDate() - startDay);
  const days: Date[] = [];
  const curr = new Date(startPad);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return days;
}

export default function AdminAppointmentsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const canCreate = useAuthStore((s) => s.isAdmin() || s.isStaff());
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [createForm, setCreateForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    date: formatDate(new Date()),
    startTime: "",
    branchId: "",
  });

  const branchFilter = selectedBranchId ?? "";

  const { startDate, endDate } = useMemo(() => {
    const d = currentDate;
    if (viewMode === "day") {
      return { startDate: formatDate(d), endDate: formatDate(d) };
    }
    if (viewMode === "week") {
      const { start, end } = getWeekRange(d);
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    const { start, end } = getMonthRange(d);
    return { startDate: formatDate(start), endDate: formatDate(end) };
  }, [viewMode, currentDate]);

  const timeOffDateRange = useMemo(() => {
    if (viewMode !== "month") return { start: startDate, end: endDate };
    const days = getMonthDays(currentDate);
    const first = days[0];
    const last = days[days.length - 1];
    return { start: formatDate(first!), end: formatDate(last!) };
  }, [viewMode, currentDate, startDate, endDate]);

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    startDate,
    endDate,
    limit: "500",
  });
  if (branchFilter) queryParams.set("branchId", branchFilter);
  if (staffFilter) queryParams.set("staffId", staffFilter);
  if (statusFilter) queryParams.set("status", statusFilter);

  const { data, isLoading, isError, error } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, startDate, endDate, branchFilter, staffFilter, statusFilter],
    queryFn: () =>
      apiClient<AppointmentsResponse>(`/appointments?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  const { data: staffList = [] } = useQuery<
    { id: string; firstName: string; lastName: string; avatarUrl?: string | null; staffServices?: { service: { id: string; name: string } }[] }[]
  >({
    queryKey: ["staff", businessId],
    queryFn: () =>
      apiClient<{ id: string; firstName: string; lastName: string; avatarUrl?: string | null; staffServices?: { service: { id: string; name: string } }[] }[]>(
        `/staff?businessId=${businessId}&includeInactive=true`
      ),
    enabled: !!businessId,
  });

  const staffAvatarMap = useMemo(
    () => new Map(staffList.map((s) => [s.id, s.avatarUrl ?? null])),
    [staffList]
  );

  const { data: timeOffList = [] } = useQuery<TimeOffItem[]>({
    queryKey: ["staff", "time-off", businessId, timeOffDateRange.start, timeOffDateRange.end],
    queryFn: () => {
      const params = new URLSearchParams({
        businessId: businessId || "",
        startDate: timeOffDateRange.start,
        endDate: timeOffDateRange.end,
      });
      return apiClient<TimeOffItem[]>(`/staff/time-off?${params}`);
    },
    enabled: !!businessId,
  });

  const scheduleBreaksDateRange = useMemo(() => {
    return { start: startDate, end: endDate };
  }, [startDate, endDate]);

  const staffIdsForBreaks = useMemo(() => {
    if (staffFilter) return [staffFilter];
    return staffList.map((s) => s.id);
  }, [staffFilter, staffList]);

  const { data: breaksByStaff = {} } = useQuery<Record<string, { weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[]; exceptions: { id: string; date: string; startTime: string; endTime: string }[] }>>({
    queryKey: ["staff", "breaks", "admin", businessId, scheduleBreaksDateRange.start, scheduleBreaksDateRange.end, staffIdsForBreaks],
    queryFn: async () => {
      const results = await Promise.all(
        staffIdsForBreaks.map((staffId) =>
          apiClient<{ weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[]; exceptions: { id: string; date: string; startTime: string; endTime: string }[] }>(
            `/staff/${staffId}/breaks?startDate=${scheduleBreaksDateRange.start}&endDate=${scheduleBreaksDateRange.end}&businessId=${businessId}`
          ).then((data) => ({ staffId, data }))
        )
      );
      return Object.fromEntries(results.map((r) => [r.staffId, r.data]));
    },
    enabled: !!businessId && (viewMode === "day" || viewMode === "week") && staffIdsForBreaks.length > 0,
  });

  const scheduleBreaksWithStaff = useMemo(() => {
    const out: { staffId: string; id: string; startTime: string; endTime: string }[] = [];
    const start = new Date(scheduleBreaksDateRange.start);
    const end = new Date(scheduleBreaksDateRange.end);
    for (const [staffId, data] of Object.entries(breaksByStaff)) {
      const { weeklyBreaks = [], exceptions = [] } = data;
      for (const ex of exceptions) {
        const d = ex.date.slice(0, 10);
        out.push({
          staffId,
          id: ex.id,
          startTime: `${d}T${ex.startTime}:00`,
          endTime: `${d}T${ex.endTime}:00`,
        });
      }
      const cursor = new Date(start);
      while (cursor <= end) {
        const dateStr = formatDate(cursor);
        const dayOfWeek = cursor.getDay();
        for (const wb of weeklyBreaks) {
          if (wb.dayOfWeek === dayOfWeek) {
            out.push({
              staffId,
              id: `wb-${staffId}-${wb.id}-${dateStr}`,
              startTime: `${dateStr}T${wb.startTime}:00`,
              endTime: `${dateStr}T${wb.endTime}:00`,
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return out;
  }, [breaksByStaff, scheduleBreaksDateRange]);

  const approvedVacations = useMemo(
    () => timeOffList.filter((v) => v.status === "APPROVED"),
    [timeOffList]
  );

  const getVacationsForDate = (date: Date) => {
    const dateStr = formatDate(date);
    return approvedVacations.filter((v) => {
      if (staffFilter && v.staff.id !== staffFilter) return false;
      const start = v.startDate.slice(0, 10);
      const end = v.endDate.slice(0, 10);
      return dateStr >= start && dateStr <= end;
    });
  };

  const isVacationToday = (v: TimeOffItem) => {
    const todayStr = formatDate(new Date());
    const start = v.startDate.slice(0, 10);
    const end = v.endDate.slice(0, 10);
    return start <= todayStr && end >= todayStr;
  };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const { data: customers = [] } = useQuery<
    { id: string; firstName: string | null; lastName: string | null; email: string }[]
  >({
    queryKey: ["customers", businessId],
    queryFn: () =>
      apiClient<{ id: string; firstName: string | null; lastName: string | null; email: string }[]>(
        `/customers?businessId=${businessId}`
      ),
    enabled: !!businessId && createModal,
  });

  const { data: services = [] } = useQuery<
    { id: string; name: string; durationMinutes: number }[]
  >({
    queryKey: ["services", businessId],
    queryFn: () =>
      apiClient<{ id: string; name: string; durationMinutes: number }[]>(
        `/services?businessId=${businessId}&includeInactive=true`
      ),
    enabled: !!businessId,
  });


  const { data: availability = [] } = useQuery<AvailabilityResult[]>({
    queryKey: ["availability", businessId, createForm.staffId, createForm.serviceId, createForm.date],
    queryFn: () =>
      apiClient<AvailabilityResult[]>(
        `/availability?businessId=${businessId}&date=${createForm.date}&staffId=${createForm.staffId}&serviceId=${createForm.serviceId}&days=1`
      ),
    enabled: !!businessId && !!createForm.staffId && !!createForm.serviceId && createModal,
  });

  const availableSlots = useMemo(() => {
    if (!createForm.staffId || !createForm.serviceId) return [];
    const result = availability.find(
      (a) => a.staffId === createForm.staffId && a.serviceId === createForm.serviceId
    );
    return result?.slots ?? [];
  }, [availability, createForm.staffId, createForm.serviceId]);

  const cancelMutation = useMutation({
    mutationFn: (appointmentId: string) =>
      apiClient("/appointments/cancel", {
        method: "POST",
        body: JSON.stringify({ appointmentId, businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setSelectedAppointment(null);
      toast.success(t("appointments.statusCancelled"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to cancel"),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof createForm) =>
      apiClient<Appointment>("/appointments/create", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          customerId: data.customerId,
          staffId: data.staffId,
          serviceId: data.serviceId,
          date: data.date,
          startTime: data.startTime,
          branchId: data.branchId || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setCreateModal(false);
      toast.success("Appointment created");
      setCreateForm({
        customerId: "",
        staffId: "",
        serviceId: "",
        date: formatDate(new Date()),
        startTime: "",
        branchId: "",
      });
    },
  });

  const appointments = data?.appointments ?? [];

  const navPrev = () => {
    const d = new Date(currentDate);
    if (viewMode === "day") d.setDate(d.getDate() - 1);
    else if (viewMode === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  };

  const navNext = () => {
    const d = new Date(currentDate);
    if (viewMode === "day") d.setDate(d.getDate() + 1);
    else if (viewMode === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const titleStr =
    viewMode === "day"
      ? currentDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : viewMode === "week"
      ? `${getWeekRange(currentDate).start.toLocaleDateString(undefined, { month: "short" })} ${getWeekRange(currentDate).start.getDate()} – ${getWeekRange(currentDate).end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const getAppointmentsForDate = (date: Date) => {
    const dateStr = formatDate(date);
    return appointments.filter((a) => a.startTime.startsWith(dateStr));
  };

  const customerName = (c: { firstName?: string | null; lastName?: string | null; email?: string } | null | undefined) =>
    c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "—" : "—";

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.appointments")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Please log in to view appointments.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">{t("nav.appointments")}</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">Unable to load appointments</p>
          <p className="mt-1 text-sm">{error instanceof Error ? error.message : "Please try again later."}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.appointments")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">{t("appointments.subtitle")}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateModal(true)}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            {t("appointments.add")}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700">
          {(["day", "week", "month"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 text-sm ${
                viewMode === m
                  ? "btn-primary"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {t(`appointments.view${m.charAt(0).toUpperCase() + m.slice(1)}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={navPrev}
            className="rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <PrevArrow className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="min-w-[140px] rounded px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {titleStr}
          </button>
          <button
            type="button"
            onClick={navNext}
            className="rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <NextArrow className="h-5 w-5" />
          </button>
        </div>
        {viewMode === "day" ? (
          <div className="w-full rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <p className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("appointments.selectStaffMember")}
            </p>
            <StaffSelector
              staffList={staffList}
              selected={staffFilter}
              onSelect={setStaffFilter}
              allLabel={t("appointments.allStaff")}
            />
          </div>
        ) : (
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">{t("appointments.filterStaff")}: {t("appointments.allStaff")}</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {createMutation.error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {createMutation.error instanceof Error
            ? createMutation.error.message
            : String(createMutation.error)}
        </div>
      )}

      {isLoading ? (
        <AppointmentCalendarSkeleton />
      ) : viewMode === "day" || viewMode === "week" ? (
        <AppointmentFullCalendar
          appointments={appointments}
          staffList={staffList}
          breaksWithStaff={scheduleBreaksWithStaff}
          vacations={approvedVacations.map((v) => ({
            id: v.id,
            staff: v.staff,
            startDate: v.startDate,
            endDate: v.endDate,
          }))}
          staffFilter={staffFilter}
          initialDate={currentDate}
          initialView={viewMode === "day" ? "resourceTimeGridDay" : "resourceTimeGridWeek"}
          locale={locale}
          customerName={customerName}
          vacationLabel={t("staff.vacation")}
          onAppointmentClick={(apt) => setSelectedAppointment(apt as Appointment)}
          onDateClick={
            canCreate
              ? (date, resourceId) => {
                  const h = date.getHours();
                  const m = date.getMinutes();
                  const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                  setCreateForm((p) => ({
                    ...p,
                    date: formatDate(date),
                    staffId: resourceId ?? p.staffId,
                    startTime,
                  }));
                  setCreateModal(true);
                }
              : undefined
          }
          onNavigate={(date) => setCurrentDate(date)}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <div className="grid grid-cols-7 gap-px bg-zinc-200 dark:bg-zinc-700">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className="bg-zinc-50 p-2 text-center text-sm font-medium dark:bg-zinc-800"
              >
                {day}
              </div>
            ))}
            {getMonthDays(currentDate).map((d, i) => {
              const apts = getAppointmentsForDate(d);
              const vacations = getVacationsForDate(d);
              const isCurrentMonth = d.getMonth() === currentDate.getMonth();
              const isToday =
                d.toDateString() === new Date().toDateString();
              return (
                <div
                  key={i}
                  className={`min-h-[100px] overflow-y-auto p-3 ${
                    isCurrentMonth ? "bg-white dark:bg-zinc-800" : "bg-zinc-50 dark:bg-zinc-900"
                  } ${isToday ? "ring-1 ring-zinc-900 dark:ring-zinc-100" : ""}`}
                >
                  <span
                    className={`text-sm font-medium ${
                      isCurrentMonth ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <div className="mt-1.5 space-y-1.5">
                    {vacations.slice(0, 3).map((v) => (
                      <div
                        key={v.id}
                        className={`flex items-center gap-1.5 truncate rounded px-2 py-1 text-xs ${
                          isVacationToday(v)
                            ? "bg-amber-200 ring-1 ring-amber-500 dark:bg-amber-900/50 dark:ring-amber-400"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        }`}
                        title={`${v.staff.firstName} ${v.staff.lastName} – ${t("staff.vacation")}`}
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
                    ))}
                    {vacations.length > 3 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        +{vacations.length - 3} {t("staff.vacation")}
                      </span>
                    )}
                    {apts.slice(0, 3).map((apt) => {
                      const staffColor = getStaffColor(apt.staff?.id);
                      const start = new Date(apt.startTime);
                      const staffAvatar = apt.staff ? staffAvatarMap.get(apt.staff.id) : null;
                      return (
                        <div
                          key={apt.id}
                          className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${staffColor}`}
                          title={`${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${customerName(apt.customer)} - ${apt.service?.name ?? "—"}`}
                        >
                          <StaffAvatar
                            avatarUrl={staffAvatar ?? null}
                            firstName={apt.staff?.firstName ?? ""}
                            lastName={apt.staff?.lastName ?? ""}
                            size="sm"
                            className="h-5 w-5 shrink-0 text-[8px]"
                          />
                          <span className="truncate">
                            {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
                            {customerName(apt.customer).slice(0, 6)}
                            {customerName(apt.customer).length > 6 ? "…" : ""}
                          </span>
                        </div>
                      );
                    })}
                    {apts.length > 3 && (
                      <span className="text-xs text-zinc-500">+{apts.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Appointment Popup */}
      {selectedAppointment && (
        <AppointmentPopup
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onDelete={() => {
            if (window.confirm(t("appointments.popupDelete") + "?")) {
              cancelMutation.mutate(selectedAppointment.id);
            }
          }}
          onPayment={() => {
            setSelectedAppointment(null);
            // TODO: Navigate to payment or open payment modal
          }}
          onChangeDuration={() => {
            setSelectedAppointment(null);
            // TODO: Open duration change modal
          }}
          onEdit={() => {
            setSelectedAppointment(null);
            toast(t("appointments.popupEdit") + " - " + (locale === "he" ? "בקרוב" : "Coming soon"));
          }}
          t={t}
          locale={locale}
        />
      )}

      {/* Create Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">{t("appointments.createTitle")}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(createForm);
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.selectCustomer")}</label>
                <select
                  value={createForm.customerId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, customerId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  required
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerName(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.selectStaff")}</label>
                <select
                  value={createForm.staffId}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      staffId: e.target.value,
                      serviceId: "",
                      startTime: "",
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  required
                >
                  <option value="">—</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.selectService")}</label>
                <select
                  value={createForm.serviceId}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      serviceId: e.target.value,
                      startTime: "",
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  required
                >
                  <option value="">—</option>
                  {(() => {
                    const staffServices = staffList.find((s) => s.id === createForm.staffId)?.staffServices;
                    const serviceList =
                      staffServices && staffServices.length > 0
                        ? staffServices.map((ss) => ({ id: ss.service.id, name: ss.service.name }))
                        : services.map((s) => ({ id: s.id, name: s.name }));
                    return serviceList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.date")}</label>
                <div className="relative">
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={createForm.date}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        date: e.target.value,
                        startTime: "",
                      }))
                    }
                    className="absolute inset-0 w-full cursor-pointer opacity-0"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const input = dateInputRef.current;
                      if (input) {
                        if (typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
                          (input as HTMLInputElement & { showPicker: () => void }).showPicker();
                        } else {
                          input.focus();
                        }
                      }
                    }}
                    className="flex min-h-11 w-full items-center justify-between rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-start dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <span>
                      {createForm.date
                        ? new Date(createForm.date + "T12:00:00").toLocaleDateString(locale, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "—"}
                    </span>
                    <Calendar className="h-4 w-4 shrink-0 text-zinc-500" />
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.timeSlot")}</label>
                <select
                  value={createForm.startTime}
                  onChange={(e) => setCreateForm((p) => ({ ...p, startTime: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  required
                >
                  <option value="">—</option>
                  {availableSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
                {createForm.staffId && createForm.serviceId && availableSlots.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">No slots available</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.filterBranch")}</label>
                <select
                  value={createForm.branchId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, branchId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                >
                  <option value="">—</option>
                  {branches.map((b) => {
                    const displayName =
                      /^main\s*branch$/i.test(b.name) ? t("branches.mainBranch") : b.name;
                    return (
                      <option key={b.id} value={b.id}>
                        {displayName}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
                >
                  {t("services.cancel")}
                </button>
                <LoadingButton
                  type="submit"
                  loading={createMutation.isPending}
                  disabled={Boolean(
                    !createForm.customerId ||
                    !createForm.staffId ||
                    !createForm.serviceId ||
                    !createForm.date ||
                    !createForm.startTime ||
                    (createForm.staffId && createForm.serviceId && availableSlots.length === 0)
                  )}
                  className="flex-1"
                >
                  {t("appointments.add")}
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
