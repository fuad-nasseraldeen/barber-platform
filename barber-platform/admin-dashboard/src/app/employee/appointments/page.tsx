"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEmployeeStaffId } from "@/hooks/use-employee-staff-id";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import toast from "react-hot-toast";
import { Check, UserX } from "lucide-react";
import { DayScheduleView } from "@/components/appointments/day-schedule-view";
import { AppointmentPopup } from "@/components/appointments/appointment-popup";
import { useResolvedScheduleTimeZone } from "@/hooks/use-resolved-schedule-timezone";
import { businessLocalYmdFromIso, formatHhMmInZone } from "@/lib/calendar-business-time";
import { customerIdToRowClass } from "@/lib/customer-tag-colors";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff: { id?: string; firstName: string; lastName: string };
  service: { name: string; durationMinutes: number };
  customer: { id?: string; firstName: string | null; lastName: string | null; phone: string | null };
  branch?: { name: string } | null;
};

type AppointmentsResponse = { appointments: Appointment[]; total: number };

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const STATUS_KEYS: Record<string, string> = {
  CONFIRMED: "appointments.statusConfirmed",
  PENDING: "appointments.statusPending",
  COMPLETED: "appointments.statusCompleted",
  CANCELLED: "appointments.statusCancelled",
  NO_SHOW: "appointments.statusNoShow",
  IN_PROGRESS: "appointments.statusConfirmed",
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  NO_SHOW: "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300",
  IN_PROGRESS: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
};

export default function EmployeeAppointmentsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessTimeZone = useResolvedScheduleTimeZone(undefined);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const staffId = useEmployeeStaffId();
  const selectedBranchId = useEffectiveBranchId(businessId);
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"schedule" | "list">("schedule");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [listStartDate, setListStartDate] = useState(formatDate(new Date()));
  const [listEndDate, setListEndDate] = useState(formatDate(new Date()));
  const [statusFilter, setStatusFilter] = useState("");

  const scheduleDateRange = useMemo(() => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);
    end.setDate(end.getDate() + 4);
    return { start: formatDate(start), end: formatDate(end) };
  }, [currentDate]);

  const scheduleParams = new URLSearchParams({
    businessId: businessId || "",
    staffId: staffId || "",
    startDate: scheduleDateRange.start,
    endDate: scheduleDateRange.end,
    limit: "100",
  });
  /** Schedule must reflect all commitments for this staff (slotKey has no branch). */
  if (statusFilter) scheduleParams.set("status", statusFilter);

  const listParams = new URLSearchParams({
    businessId: businessId || "",
    staffId: staffId || "",
    startDate: listStartDate,
    endDate: listEndDate,
    limit: "100",
  });
  if (selectedBranchId) listParams.set("branchId", selectedBranchId);
  if (statusFilter) listParams.set("status", statusFilter);

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", "schedule", businessId, staffId, scheduleDateRange.start, scheduleDateRange.end, statusFilter],
    queryFn: () => apiClient(`/appointments?${scheduleParams}`),
    enabled: !!businessId && !!staffId && viewMode === "schedule",
  });

  const { data: listData, isLoading: listLoading } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, staffId, listStartDate, listEndDate, selectedBranchId, statusFilter],
    queryFn: () => apiClient(`/appointments?${listParams}`),
    enabled: !!businessId && !!staffId && viewMode === "list",
  });

  const { data: breaksData } = useQuery<{
    weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
    exceptions: { id: string; date: string; startTime: string; endTime: string }[];
  }>({
    queryKey: ["staff", "me", "breaks", scheduleDateRange.start, scheduleDateRange.end],
    queryFn: () =>
      apiClient(
        `/staff/me/breaks?startDate=${scheduleDateRange.start}&endDate=${scheduleDateRange.end}`
      ),
    enabled: !!staffId && viewMode === "schedule",
  });

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
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "COMPLETED" | "NO_SHOW" }) =>
      apiClient(`/appointments/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ businessId, status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("employee.statusUpdated"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const scheduleAppointments = scheduleData?.appointments ?? [];
  const listAppointments = listData?.appointments ?? [];
  const canUpdate = (apt: Appointment) =>
    !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(apt.status);

  const getStatusColor = (status: string) =>
    STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";

  const staffAvatarMap = useMemo(() => new Map<string, string | null>(), []);
  const customerName = (c: { firstName?: string | null; lastName?: string | null } | null) =>
    c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || "—" : "—";

  const scheduleBreaks = useMemo(() => {
    const out: { id: string; startTime: string; endTime: string }[] = [];
    const { weeklyBreaks = [], exceptions = [] } = breaksData ?? {};
    for (const ex of exceptions) {
      const d = ex.date.slice(0, 10);
      out.push({
        id: ex.id,
        startTime: `${d}T${ex.startTime}:00`,
        endTime: `${d}T${ex.endTime}:00`,
      });
    }
    for (let i = 0; i < 5; i++) {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);
      const dayOfWeek = d.getDay();
      for (const wb of weeklyBreaks) {
        if (wb.dayOfWeek === dayOfWeek) {
          out.push({
            id: `wb-${wb.id}-${dateStr}`,
            startTime: `${dateStr}T${wb.startTime}:00`,
            endTime: `${dateStr}T${wb.endTime}:00`,
          });
        }
      }
    }
    return out;
  }, [breaksData, currentDate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("employee.myAppointments")}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("schedule")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === "schedule"
                ? "bg-[var(--primary)] text-white"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {t("appointments.viewDay")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === "list"
                ? "bg-[var(--primary)] text-white"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {t("employee.listView")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="">{t("appointments.statusAll")}</option>
          <option value="CONFIRMED">{t("appointments.statusConfirmed")}</option>
          <option value="PENDING">{t("appointments.statusPending")}</option>
          <option value="COMPLETED">{t("appointments.statusCompleted")}</option>
          <option value="NO_SHOW">{t("appointments.statusNoShow")}</option>
          <option value="CANCELLED">{t("appointments.statusCancelled")}</option>
        </select>
      </div>

      {viewMode === "schedule" ? (
        scheduleLoading ? (
          <p className="text-zinc-500">{t("widget.loading")}</p>
        ) : (
          <>
            <DayScheduleView
              date={currentDate}
              businessTimezone={businessTimeZone}
              appointments={scheduleAppointments.map((a) => ({
                ...a,
                staff: a.staff ? { id: a.staff.id ?? "", firstName: a.staff.firstName, lastName: a.staff.lastName } : undefined,
                service: { name: a.service.name },
                customer: a.customer,
              }))}
              vacations={[]}
              breaks={scheduleBreaks}
              staffColor={() => ""}
              getAppointmentColor={(apt) =>
                customerIdToRowClass((apt.customer as { id?: string })?.id)
              }
              staffAvatarMap={staffAvatarMap}
              onAppointmentClick={(apt) => setSelectedAppointment(apt as Appointment)}
              customerName={customerName}
              vacationLabel={t("staff.vacation")}
              onDateSelect={setCurrentDate}
              daySelectorDays={5}
              locale={locale}
            />
            {selectedAppointment && (
            <AppointmentPopup
              appointment={selectedAppointment}
              businessTimeZone={businessTimeZone}
              onClose={() => setSelectedAppointment(null)}
              onDelete={() => {
                if (window.confirm(t("appointments.popupDelete") + "?")) {
                  cancelMutation.mutate(selectedAppointment.id);
                }
              }}
              onPayment={() => {
                setSelectedAppointment(null);
                toast(t("appointments.popupPayment") + " – " + (locale === "he" ? "בקרוב" : "Coming soon"));
              }}
              onChangeDuration={() => {
                setSelectedAppointment(null);
                toast(t("appointments.popupChangeDuration") + " – " + (locale === "he" ? "בקרוב" : "Coming soon"));
              }}
              onEdit={() => {
                setSelectedAppointment(null);
                toast(t("appointments.popupEdit") + " – " + (locale === "he" ? "בקרוב" : "Coming soon"));
              }}
              t={t}
              locale={locale}
            />
            )}
          </>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{t("employee.from")}</label>
              <input
                type="date"
                value={listStartDate}
                onChange={(e) => setListStartDate(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{t("employee.to")}</label>
              <input
                type="date"
                value={listEndDate}
                onChange={(e) => setListEndDate(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
              />
            </div>
          </div>

          {listLoading ? (
            <p className="text-zinc-500">{t("widget.loading")}</p>
          ) : listAppointments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500 dark:border-zinc-600">
              {t("employee.noAppointmentsFound")}
            </p>
          ) : (
            <div className="space-y-3">
              {listAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <div>
                    <p className="font-semibold">
                      {apt.customer.firstName} {apt.customer.lastName}
                    </p>
                    <p className="text-sm text-zinc-500">{apt.service.name}</p>
                    <p className="text-sm text-zinc-500">
                      {businessLocalYmdFromIso(apt.startTime, businessTimeZone)}{" "}
                      {formatHhMmInZone(apt.startTime, businessTimeZone)} –{" "}
                      {formatHhMmInZone(apt.endTime, businessTimeZone)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-1 text-xs ${STATUS_COLORS[apt.status] ?? "bg-zinc-100"}`}>
                      {STATUS_KEYS[apt.status] ? t(STATUS_KEYS[apt.status]) : apt.status}
                    </span>
                    {canUpdate(apt) && (
                      <>
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: apt.id, status: "COMPLETED" })}
                          disabled={updateStatusMutation.isPending}
                          className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" /> {t("employee.complete")}
                        </button>
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: apt.id, status: "NO_SHOW" })}
                          disabled={updateStatusMutation.isPending}
                          className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
                        >
                          <UserX className="h-4 w-4" /> {t("appointments.statusNoShow")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
