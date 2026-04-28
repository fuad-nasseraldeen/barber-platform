"use client";

import { useState, useMemo, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { apiClient, translateApiRequestError } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import toast from "react-hot-toast";
import { PrevArrow, NextArrow } from "@/components/ui/nav-arrow";
import { Calendar, User, Scissors, Clock, TimerOff } from "lucide-react";
import { AppointmentCalendarSkeleton } from "@/components/ui/skeleton";
import { LoadingButton } from "@/components/ui/loading-button";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { StaffSelector } from "@/components/appointments/staff-selector";
import { AppointmentPopup } from "@/components/appointments/appointment-popup";
import {
  StaffScheduleCalendar,
  type ScheduleCalendarAppointment,
  type ScheduleOverlay,
} from "@/components/appointments/staff-schedule-calendar";
import { customerIdToRowClass, resolveCustomerEventColor } from "@/lib/customer-tag-colors";
import {
  businessLocalYmdFromIso,
  formatHhMmInZone,
  hhmmToMinutes,
  jsDayOfWeekInZone,
  minutesFromMidnightInZone,
  wallTimeToUtcIso,
} from "@/lib/calendar-business-time";
import { ScheduleDayStrip, buildDayStripItems } from "@/components/appointments/schedule-day-strip";
import { ScheduleCalendarFab, FabIcons } from "@/components/appointments/schedule-calendar-fab";
import { BlockTimeDialog } from "@/components/appointments/block-time-dialog";
import { RemoveTimeBlocksDialog } from "@/components/appointments/remove-time-blocks-dialog";
import { useResolvedScheduleTimeZone } from "@/hooks/use-resolved-schedule-timezone";

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
    tagColor?: string | null;
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

/** Browser parity with server `LOG_AVAILABILITY_QUERY_DEBUG` — set NEXT_PUBLIC_LOG_AVAILABILITY_QUERY=1 */
function logAvailabilityQueryDebugBrowser(pathWithQuery: string) {
  if (process.env.NEXT_PUBLIC_LOG_AVAILABILITY_QUERY !== "1") return;
  try {
    const u = new URL(pathWithQuery, "http://localhost");
    const raw: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      raw[k] = v;
    });
    console.log("RAW QUERY:", raw);
    console.log("COMPACT AFTER TRANSFORM:", u.searchParams.get("compact"));
  } catch {
    /* ignore */
  }
}

type TimeOffItem = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  staff: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
};

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const EMPTY_SLOT_OPTIONS: string[] = [];

/** Align with API / slot strings (HH:mm, 24h). */
function normalizeWallHhMm(raw: string): string {
  const trimmed = raw.trim();
  const parts = trimmed.split(":");
  if (parts.length < 2) return trimmed;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return trimmed;
  return `${String(Math.min(23, Math.max(0, h))).padStart(2, "0")}:${String(Math.min(59, Math.max(0, m))).padStart(2, "0")}`;
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
  const router = useRouter();
  const t = useTranslation();
  const createAppointmentTimeSelectId = useId();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const calendarNavDateInputRef = useRef<HTMLInputElement>(null);
  const createModalPanelRef = useRef<HTMLDivElement>(null);
  const canCreate = useAuthStore((s) => s.isAdmin() || s.isStaff());
  const effectiveBranchId = useEffectiveBranchId(businessId);
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [staffFilter, setStaffFilter] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [deleteModalAppointment, setDeleteModalAppointment] = useState<Appointment | null>(null);
  const [blockTimeOpen, setBlockTimeOpen] = useState(false);
  const [removeTimeBlocksOpen, setRemoveTimeBlocksOpen] = useState(false);
  /** So create-appointment portal runs only in the browser (avoids SSR/hydration issues). */
  const [createModalPortalReady, setCreateModalPortalReady] = useState(false);
  /** Minute pulse: today's day-grid range can grow past shift end so "now" stays on the axis. */
  const [dayGridNowTick, setDayGridNowTick] = useState(0);
  /** דקה תוך כדי מודל יצירת תור — מרענן סינון סלוטים שעברו (לא מסתמך על useMemo קפוא ל"היום"). */
  const [createModalNowTick, setCreateModalNowTick] = useState(0);
  useEffect(() => {
    setCreateModalPortalReady(true);
  }, []);
  const [createForm, setCreateForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    date: formatDate(new Date()),
    startTime: "",
    branchId: "",
  });
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

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    startDate,
    endDate,
    limit: "500",
  });
  /** `slotKey` is per staff+wall time (no branch) — omit branchId so calendar busy matches GET /availability. */
  if (staffFilter) queryParams.set("staffId", staffFilter);

  const { data, isLoading, isError, error } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, startDate, endDate, staffFilter],
    queryFn: () =>
      apiClient<AppointmentsResponse>(`/appointments?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  const { data: businessRow } = useQuery({
    queryKey: ["business", businessId, "tz"],
    queryFn: () => apiClient<{ timezone: string | null }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });
  const businessTimeZone = useResolvedScheduleTimeZone(businessRow?.timezone ?? null);
  
  const { data: staffList = [] } = useQuery<
    {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl?: string | null;
      staffServices?: { durationMinutes?: number; service: { id: string; name: string } }[];
      staffWorkingHours?: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
      staffBreaks?: Array<{ id: string; dayOfWeek: number; startTime: string; endTime: string }>;
    }[]
  >({
    queryKey: ["staff", businessId],
    queryFn: () =>
      apiClient<
        {
          id: string;
          firstName: string;
          lastName: string;
          avatarUrl?: string | null;
          staffServices?: { durationMinutes?: number; service: { id: string; name: string } }[];
        }[]
      >(
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

  const { data: breaksByStaff = {} } = useQuery<
    Record<
      string,
      {
        weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
        exceptions: {
          id: string;
          date: string;
          startTime: string;
          endTime: string;
          kind?: "BREAK" | "TIME_BLOCK";
        }[];
      }
    >
  >({
    queryKey: ["staff", "breaks", "admin", businessId, scheduleBreaksDateRange.start, scheduleBreaksDateRange.end, staffIdsForBreaks],
    queryFn: async () => {
      type BreaksPayload = {
        weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
        exceptions: {
          id: string;
          date: string;
          startTime: string;
          endTime: string;
          kind?: "BREAK" | "TIME_BLOCK";
        }[];
      };
      const out: Record<string, BreaksPayload> = {};
      /** סדרתי — מניעת 429 מ-Throttler הקצר (3 בקשות/שנייה גלובליות ב-backend). */
      for (const staffId of staffIdsForBreaks) {
        const data = await apiClient<BreaksPayload>(
          `/staff/${staffId}/breaks?startDate=${scheduleBreaksDateRange.start}&endDate=${scheduleBreaksDateRange.end}&businessId=${businessId}`,
        );
        out[staffId] = data;
      }
      return out;
    },
    enabled: !!businessId && staffIdsForBreaks.length > 0,
  });

  const approvedVacations = useMemo(
    () => timeOffList.filter((v) => v.status === "APPROVED"),
    [timeOffList]
  );

  const datesInView = useMemo(() => {
    const base = DateTime.fromJSDate(currentDate, { zone: businessTimeZone });
    if (viewMode === "day") return [base.toISODate()!];
    const jsDow = base.weekday % 7;
    const start = base.minus({ days: jsDow });
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
  }, [currentDate, viewMode, businessTimeZone]);

  const calendarStaff = useMemo(() => {
    if (staffFilter) return staffList.filter((s) => s.id === staffFilter);
    return staffList;
  }, [staffList, staffFilter]);

  const scheduleOverlays = useMemo((): ScheduleOverlay[] => {
    const out: ScheduleOverlay[] = [];
    const gridStartMin = 7 * 60;
    const gridEndMin = 21 * 60;
    const seenBreakKeys = new Set<string>();
    for (const ymd of datesInView) {
      const dow = jsDayOfWeekInZone(ymd, businessTimeZone);
      for (const s of calendarStaff) {
        const addWeeklyBreak = (b: { id: string; dayOfWeek: number; startTime: string; endTime: string }) => {
          if (b.dayOfWeek !== dow) return;
          const key = `${s.id}|${b.id}|${ymd}`;
          if (seenBreakKeys.has(key)) return;
          seenBreakKeys.add(key);
          out.push({
            id: `wb-${s.id}-${ymd}-${b.id}`,
            staffId: s.id,
            startTime: wallTimeToUtcIso(ymd, businessTimeZone, hhmmToMinutes(b.startTime)),
            endTime: wallTimeToUtcIso(ymd, businessTimeZone, hhmmToMinutes(b.endTime)),
            variant: "break",
          });
        };
        for (const b of s.staffBreaks?.filter((x) => x.dayOfWeek === dow) ?? []) {
          addWeeklyBreak(b);
        }
        for (const b of breaksByStaff[s.id]?.weeklyBreaks ?? []) {
          addWeeklyBreak(b);
        }
        const brData = breaksByStaff[s.id];
        for (const ex of brData?.exceptions ?? []) {
          const exYmd = ex.date.slice(0, 10);
          if (exYmd !== ymd) continue;
          out.push({
            id: `ex-${ex.id}-${ymd}`,
            staffId: s.id,
            startTime: wallTimeToUtcIso(ymd, businessTimeZone, hhmmToMinutes(ex.startTime)),
            endTime: wallTimeToUtcIso(ymd, businessTimeZone, hhmmToMinutes(ex.endTime)),
            variant: ex.kind === "TIME_BLOCK" ? "time_block" : "break",
          });
        }
      }
      for (const v of approvedVacations) {
        if (staffFilter && v.staff.id !== staffFilter) continue;
        if (!calendarStaff.some((st) => st.id === v.staff.id)) continue;
        const vs = v.startDate.slice(0, 10);
        const ve = v.endDate.slice(0, 10);
        if (ymd >= vs && ymd <= ve) {
          out.push({
            id: `vac-${v.id}-${ymd}`,
            staffId: v.staff.id,
            startTime: wallTimeToUtcIso(ymd, businessTimeZone, gridStartMin),
            endTime: wallTimeToUtcIso(ymd, businessTimeZone, gridEndMin),
            variant: "vacation",
          });
        }
      }
    }
    return out;
  }, [datesInView, calendarStaff, businessTimeZone, approvedVacations, staffFilter, breaksByStaff]);

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
    {
      id: string;
      name: string;
      durationMinutes: number;
      bufferBeforeMinutes?: number;
      bufferAfterMinutes?: number;
    }[]
  >({
    queryKey: ["services", businessId],
    queryFn: () =>
      apiClient<
        {
          id: string;
          name: string;
          durationMinutes: number;
          bufferBeforeMinutes?: number;
          bufferAfterMinutes?: number;
        }[]
      >(`/services?businessId=${businessId}&includeInactive=true`),
    enabled: !!businessId,
  });

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  useEffect(() => {
    if (!createModal) return;
    const t = window.setTimeout(() => {
      createModalPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    }, 50);
    return () => window.clearTimeout(t);
  }, [createModal]);

  const minServiceMinutes = useMemo(
    () => (services.length ? Math.min(...services.map((s) => Math.max(5, s.durationMinutes))) : 15),
    [services]
  );

  const calendarDebugGaps = process.env.NEXT_PUBLIC_CALENDAR_DEBUG_GAPS === "1";

  const { data: availability = [], isFetching: createAvailabilityLoading } = useQuery<AvailabilityResult[]>({
    queryKey: [
      "availability",
      businessId,
      createForm.staffId,
      createForm.serviceId,
      createForm.date,
      "chrono",
    ],
    queryFn: () => {
      const path = `/availability?businessId=${businessId}&date=${createForm.date}&staffId=${createForm.staffId}&serviceId=${createForm.serviceId}&days=1&chronologicalSlots=1`;
      logAvailabilityQueryDebugBrowser(path);
      return apiClient<AvailabilityResult[]>(path);
    },
    enabled: !!businessId && !!createForm.staffId && !!createForm.serviceId && createModal,
    /** Override global staleTime here to avoid stale slots after service/date changes. */
    staleTime: 0,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: "always",
  });

  const availableSlots = useMemo(() => {
    if (!createForm.staffId || !createForm.serviceId) return [];
    const result = availability.find((a) => a.staffId === createForm.staffId);
    const slots = result?.slots ?? [];
    return [...slots].sort((a, b) => {
      const [ah, am] = a.split(":").map(Number);
      const [bh, bm] = b.split(":").map(Number);
      return ah * 60 + am - (bh * 60 + bm);
    });
  }, [availability, createForm.staffId, createForm.serviceId]);

  /** לא ב-useMemo — "היום" חייב להתאים לשעון העסק בכל רינדור (אחרת אחרי חצות / טאב פתוח מסננים מוקדם מדי / מאוחר מדי). */
  const todayYmdBusinessForCreate = DateTime.now().setZone(businessTimeZone).toISODate() ?? "";

  const availableSlotsForPicker = useMemo(() => {
    const dateYmd = createForm.date?.slice(0, 10) ?? "";
    if (!dateYmd || dateYmd !== todayYmdBusinessForCreate) return availableSlots;
    const now = DateTime.now().setZone(businessTimeZone);
    const nowMin = now.hour * 60 + now.minute;
    return availableSlots.filter((slot) => {
      const [h, m] = slot.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return true;
      return h * 60 + m > nowMin;
    });
  }, [
    availableSlots,
    createForm.date,
    businessTimeZone,
    todayYmdBusinessForCreate,
    createModalNowTick,
  ]);

  /** Slots shown in create modal — only these may be submitted (no native time wheel). */
  const createFormTimeOptions = useMemo(() => {
    if (!createForm.staffId || !createForm.serviceId || !createForm.date) return EMPTY_SLOT_OPTIONS;
    return createForm.date === todayYmdBusinessForCreate
      ? availableSlotsForPicker
      : availableSlots;
  }, [
    availableSlots,
    availableSlotsForPicker,
    createForm.date,
    createForm.serviceId,
    createForm.staffId,
    todayYmdBusinessForCreate,
  ]);

  const createTimeFieldReady =
    !!createForm.staffId && !!createForm.serviceId && !!createForm.date && createModal;

  useEffect(() => {
    if (!createTimeFieldReady) return;
    if (createAvailabilityLoading) return;
    setCreateForm((p) => {
      if (!p.startTime) return p;
      if (createFormTimeOptions.length === 0) {
        return { ...p, startTime: "" };
      }
      const norm = normalizeWallHhMm(p.startTime);
      if (createFormTimeOptions.includes(p.startTime) || createFormTimeOptions.includes(norm)) {
        return p.startTime === norm ? p : { ...p, startTime: norm };
      }
      return { ...p, startTime: "" };
    });
  }, [
    createAvailabilityLoading,
    createFormTimeOptions,
    createTimeFieldReady,
  ]);

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

  const openDayMutation = useMutation({
    mutationFn: async (ymd: string) => {
      if (!businessId || !staffFilter) throw new Error("missing");
      const dayOfWeek = jsDayOfWeekInZone(ymd, businessTimeZone);
      await apiClient("/staff/working-hours", {
        method: "POST",
        body: JSON.stringify({
          staffId: staffFilter,
          businessId,
          dayOfWeek,
          startTime: "09:00",
          endTime: "18:00",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      toast.success(t("appointments.scheduleOpenDaySuccess"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; staffId: string; startTime: string; endTime: string }) =>
      apiClient<Appointment>(`/appointments/${data.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          staffId: data.staffId,
          startTime: data.startTime,
          endTime: data.endTime,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(t("appointments.updated") || "Appointment updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const staffRow = staffList.find((s) => s.id === data.staffId);
      const staffOffering = staffRow?.staffServices?.find((ss) => ss.service.id === data.serviceId);
      const serviceRow = services.find((s) => s.id === data.serviceId);
      const coreMinutes =
        staffOffering?.durationMinutes != null && Number.isFinite(staffOffering.durationMinutes)
          ? staffOffering.durationMinutes
          : (serviceRow?.durationMinutes ?? 30);
      const bufBefore = serviceRow?.bufferBeforeMinutes ?? 0;
      const bufAfter = serviceRow?.bufferAfterMinutes ?? 0;
      /** Must match assertSlotHoldOfferedByAvailabilityEngine: core + service buffers. */
      const durationMinutes = coreMinutes + bufBefore + bufAfter;
      const holdPayload = {
        businessId,
        staffId: data.staffId,
        serviceId: data.serviceId,
        customerId: data.customerId,
        date: data.date.slice(0, 10),
        startTime: normalizeWallHhMm(data.startTime),
        durationMinutes,
      };
      const holdRes = await apiClient<{ hold: { id: string } }>("/appointments/slot-holds", {
        method: "POST",
        body: JSON.stringify(holdPayload),
      });
      return apiClient<Appointment>("/appointments/create", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          slotHoldId: holdRes.hold.id,
          branchId: data.branchId || undefined,
          idempotencyKey: `admin-create:${holdRes.hold.id}`,
        }),
      });
    },
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
        branchId: effectiveBranchId ?? "",
      });
    },
    onError: (e) =>
      toast.error(translateApiRequestError(e, t, t("appointments.createFailed"))),
  });

  const appointments = data?.appointments ?? [];

  const appointmentsForCalendar = useMemo(
    () => appointments.filter((a) => !["CANCELLED", "NO_SHOW"].includes(a.status)),
    [appointments],
  );

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

  const luxonLocale = locale === "he" ? "he" : locale === "ar" ? "ar" : "en";

  const periodTitle = useMemo(() => {
    if (viewMode === "day") {
      return DateTime.fromJSDate(currentDate).setLocale(luxonLocale).toFormat("EEEE, d MMMM yyyy");
    }
    if (viewMode === "week") {
      const { start, end } = getWeekRange(currentDate);
      const s = DateTime.fromJSDate(start).setLocale(luxonLocale);
      const e = DateTime.fromJSDate(end).setLocale(luxonLocale);
      if (s.month === e.month && s.year === e.year) {
        return `${s.toFormat("d")}–${e.toFormat("d")} ${s.toFormat("MMMM yyyy")}`;
      }
      if (s.year === e.year) {
        return `${s.toFormat("d MMM")} – ${e.toFormat("d MMM yyyy")}`;
      }
      return `${s.toFormat("d MMM yyyy")} – ${e.toFormat("d MMM yyyy")}`;
    }
    return DateTime.fromJSDate(currentDate).setLocale(luxonLocale).toFormat("MMMM yyyy");
  }, [viewMode, currentDate, luxonLocale]);

  const isViewingToday = useMemo(() => {
    const now = new Date();
    const todayStr = formatDate(now);
    if (viewMode === "day") return formatDate(currentDate) === todayStr;
    if (viewMode === "week") {
      const { start, end } = getWeekRange(currentDate);
      return todayStr >= formatDate(start) && todayStr <= formatDate(end);
    }
    return currentDate.getFullYear() === now.getFullYear() && currentDate.getMonth() === now.getMonth();
  }, [viewMode, currentDate]);

  const openCalendarNavPicker = () => {
    const input = calendarNavDateInputRef.current;
    if (!input) return;
    const el = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof el.showPicker === "function") el.showPicker();
    else input.click();
  };

  const onCalendarNavDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) return;
    setCurrentDate(new Date(`${v}T12:00:00`));
  };

  const getAppointmentsForDate = (date: Date) => {
    const dateStr = formatDate(date);
    return appointmentsForCalendar.filter((a) => a.startTime.startsWith(dateStr));
  };

  const customerName = (c: { firstName?: string | null; lastName?: string | null; email?: string } | null | undefined) =>
    c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "—" : "—";

  const selectedYmdBusiness = useMemo(() => {
    const dt = DateTime.fromJSDate(currentDate, { zone: businessTimeZone });
    return dt.toISODate()!;
  }, [currentDate, businessTimeZone]);

  const todayYmdBusiness = useMemo(
    () => DateTime.now().setZone(businessTimeZone).toISODate()!,
    [businessTimeZone],
  );

  /** דיבוג: קונסול — לכל עובד תורים ביום הנבחר + סלוטים פנויים לכל שירות. הפעלה: NEXT_PUBLIC_SCHEDULE_STAFF_DEBUG=1 */
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SCHEDULE_STAFF_DEBUG !== "1") return;
    if (!businessId || !selectedYmdBusiness || staffList.length === 0) return;

    let cancelled = false;

    void (async () => {
      const groupLabel = `[SCHEDULE_STAFF_DEBUG] ${selectedYmdBusiness} · ${staffList.length} staff`;
      console.groupCollapsed(`%c${groupLabel}`, "color:#0284c7;font-weight:bold");

      for (const s of staffList) {
        if (cancelled) break;

        const dayAppts = appointmentsForCalendar.filter(
          (a) =>
            a.staff.id === s.id &&
            businessLocalYmdFromIso(a.startTime, businessTimeZone) === selectedYmdBusiness,
        );

        const תורים = [...dayAppts]
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((a) => ({
            התחלה: formatHhMmInZone(a.startTime, businessTimeZone),
            סיום: formatHhMmInZone(a.endTime, businessTimeZone),
            שירות: a.service?.name ?? "—",
            לקוח: a.customer
              ? [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ") ||
                a.customer.email ||
                "—"
              : "—",
            סטטוס: a.status,
          }));

        const staffServiceRows =
          s.staffServices?.filter((ss) => ss.service?.id) ?? [];
        const fallbackService =
          services.length > 0
            ? services.slice().sort((a, b) => a.durationMinutes - b.durationMinutes)[0]
            : null;

        const servicesToQuery =
          staffServiceRows.length > 0
            ? staffServiceRows.map((ss) => ({
                id: ss.service!.id,
                name: ss.service!.name,
              }))
            : fallbackService
              ? [{ id: fallbackService.id, name: fallbackService.name }]
              : [];

        type FreeRow = { שם: string; סלוטים: string[]; שגיאה?: string };
        const פנויים_לפי_שירות: Record<string, FreeRow> = {};

        for (const svc of servicesToQuery) {
          if (cancelled) break;
          try {
            const params = new URLSearchParams({
              businessId,
              date: selectedYmdBusiness,
              staffId: s.id,
              serviceId: svc.id,
              days: "1",
              chronologicalSlots: "1",
            });
            const path = `/availability?${params.toString()}`;
            logAvailabilityQueryDebugBrowser(path);
            const av = await apiClient<AvailabilityResult[]>(path);
            const slots = av.find((row) => row.staffId === s.id)?.slots ?? [];
            פנויים_לפי_שירות[svc.id] = { שם: svc.name, סלוטים: [...slots] };
          } catch (err) {
            פנויים_לפי_שירות[svc.id] = {
              שם: svc.name,
              סלוטים: [],
              שגיאה: err instanceof Error ? err.message : String(err),
            };
          }
        }

        console.log(
          `%c${s.firstName} ${s.lastName}%c ${s.id}`,
          "font-weight:600",
          "color:#71717a",
          { תורים, פנויים_לפי_שירות },
        );
      }

      console.groupEnd();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    businessId,
    selectedYmdBusiness,
    businessTimeZone,
    staffList,
    appointmentsForCalendar,
    services,
  ]);

  useEffect(() => {
    if (viewMode !== "day") return;
    if (selectedYmdBusiness !== todayYmdBusiness) return;
    const id = window.setInterval(() => setDayGridNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [viewMode, selectedYmdBusiness, todayYmdBusiness]);

  useEffect(() => {
    if (!createModal) return;
    const id = window.setInterval(() => setCreateModalNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [createModal]);

  const staffDayOfWeekSet = useMemo(() => {
    if (!staffFilter) return null;
    const s = staffList.find((x) => x.id === staffFilter);
    if (!s?.staffWorkingHours?.length) return new Set<number>();
    return new Set(s.staffWorkingHours.map((h) => h.dayOfWeek));
  }, [staffFilter, staffList]);

  const dayStripItems = useMemo(
    () =>
      buildDayStripItems({
        anchorYmd: selectedYmdBusiness,
        selectedYmd: selectedYmdBusiness,
        businessTimeZone,
        locale,
        staffDayOfWeekSet,
        todayYmd: todayYmdBusiness,
        labels: {
          today: t("appointments.today"),
          tomorrow: t("appointments.tomorrow"),
        },
      }),
    [selectedYmdBusiness, businessTimeZone, locale, staffDayOfWeekSet, todayYmdBusiness, t],
  );

  const dayWorkingHoursLine = useMemo(() => {
    if (!staffFilter || viewMode !== "day") return null;
    const s = staffList.find((x) => x.id === staffFilter);
    if (!s?.staffWorkingHours?.length) return null;
    const dow = jsDayOfWeekInZone(selectedYmdBusiness, businessTimeZone);
    const wh = s.staffWorkingHours.find((h) => h.dayOfWeek === dow);
    if (!wh) return null;
    return { start: wh.startTime, end: wh.endTime };
  }, [staffFilter, viewMode, staffList, selectedYmdBusiness, businessTimeZone]);

  const selectedDayAppointmentCount = useMemo(() => {
    if (viewMode !== "day" || !staffFilter) return null;
    return appointmentsForCalendar.filter(
      (a) =>
        a.staff.id === staffFilter &&
        businessLocalYmdFromIso(a.startTime, businessTimeZone) === selectedYmdBusiness,
    ).length;
  }, [
    viewMode,
    staffFilter,
    appointmentsForCalendar,
    businessTimeZone,
    selectedYmdBusiness,
  ]);

  const dayCardTitleText = useMemo(
    () =>
      DateTime.fromISO(selectedYmdBusiness, { zone: businessTimeZone })
        .setLocale(luxonLocale)
        .toFormat("EEEE, d MMMM"),
    [selectedYmdBusiness, businessTimeZone, luxonLocale],
  );

  const timeBlockExceptionsForSelectedDay = useMemo(() => {
    const ymd = selectedYmdBusiness;
    const out: {
      id: string;
      staffId: string;
      staffName: string;
      startTime: string;
      endTime: string;
    }[] = [];
    for (const s of calendarStaff) {
      for (const ex of breaksByStaff[s.id]?.exceptions ?? []) {
        if (ex.date.slice(0, 10) !== ymd) continue;
        if (ex.kind !== "TIME_BLOCK") continue;
        out.push({
          id: ex.id,
          staffId: s.id,
          staffName: `${s.firstName} ${s.lastName}`.trim(),
          startTime: normalizeWallHhMm(ex.startTime),
          endTime: normalizeWallHhMm(ex.endTime),
        });
      }
    }
    out.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.staffName.localeCompare(b.staffName));
    return out;
  }, [selectedYmdBusiness, calendarStaff, breaksByStaff]);

  /** Day + single staff: axis matches shift wall times; break blocks past shift end still fit (e.g. 17:00–17:15). */
  const dayCalendarGridRange = useMemo(() => {
    if (viewMode !== "day" || !staffFilter) return null;

    let startMin = Infinity;
    let endMin = -Infinity;
    const expand = (a: number, b: number) => {
      startMin = Math.min(startMin, a);
      endMin = Math.max(endMin, b);
    };

    if (dayWorkingHoursLine) {
      expand(hhmmToMinutes(dayWorkingHoursLine.start), hhmmToMinutes(dayWorkingHoursLine.end));
    }

    for (const a of appointmentsForCalendar) {
      if (a.staff?.id !== staffFilter) continue;
      if (businessLocalYmdFromIso(a.startTime, businessTimeZone) !== selectedYmdBusiness) continue;
      expand(
        Math.floor(minutesFromMidnightInZone(a.startTime, businessTimeZone)),
        Math.ceil(minutesFromMidnightInZone(a.endTime, businessTimeZone)),
      );
    }

    for (const o of scheduleOverlays) {
      if (o.staffId !== staffFilter || o.variant !== "break") continue;
      if (businessLocalYmdFromIso(o.startTime, businessTimeZone) !== selectedYmdBusiness) continue;
      expand(
        Math.floor(minutesFromMidnightInZone(o.startTime, businessTimeZone)),
        Math.ceil(minutesFromMidnightInZone(o.endTime, businessTimeZone)),
      );
    }

    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
    startMin = Math.max(0, startMin);
    endMin = Math.min(24 * 60, endMin);

    if (selectedYmdBusiness === todayYmdBusiness) {
      const nowWall = DateTime.now().setZone(businessTimeZone);
      if (nowWall.isValid) {
        const nm = nowWall.hour * 60 + nowWall.minute;
        const pad = 90;
        startMin = Math.min(startMin, Math.max(0, nm - pad));
        endMin = Math.max(endMin, Math.min(24 * 60, nm + pad));
      }
    }

    if (endMin - startMin < 30) return null;
    return { startMin, endMin };
  }, [
    viewMode,
    staffFilter,
    dayWorkingHoursLine,
    appointmentsForCalendar,
    scheduleOverlays,
    businessTimeZone,
    selectedYmdBusiness,
    todayYmdBusiness,
    dayGridNowTick,
  ]);

  const stripDir = locale === "he" || locale === "ar" ? "rtl" : "ltr";
  /** RTL: flip chevron icons only; prev/next behavior stays LTR (left = earlier, right = later). */
  const flipCalNavIcons = stripDir === "rtl";
  const calNavArrowIconClass = flipCalNavIcons ? "h-4 w-4 scale-x-[-1]" : "h-4 w-4";

  const viewModePill = (
    <div className="flex w-full justify-center px-0.5">
      <div className="inline-flex w-full max-w-md rounded-xl bg-[var(--primary)]/14 p-0.5 shadow-inner dark:bg-[var(--primary)]/18">
        {(["day", "week", "month"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setViewMode(m)}
            className={`min-h-8 flex-1 rounded-lg px-2 py-1 text-center text-xs font-semibold transition-all duration-200 sm:min-h-9 sm:px-3 sm:text-sm ${
              viewMode === m
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                : "text-zinc-700 hover:bg-white/55 dark:text-[var(--primary)] dark:hover:bg-white/10"
            }`}
          >
            {t(`appointments.view${m.charAt(0).toUpperCase() + m.slice(1)}`)}
          </button>
        ))}
      </div>
    </div>
  );

  const dateNavRow = (
    <div
      dir="ltr"
      className="inline-flex flex-wrap items-center justify-center gap-0.5 sm:gap-1"
      lang={locale === "he" ? "he" : locale === "ar" ? "ar" : "en"}
    >
      <button
        type="button"
        onClick={navPrev}
        aria-label={t("appointments.navPrevious")}
        className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <PrevArrow className={calNavArrowIconClass} />
      </button>
      <button
        type="button"
        dir="auto"
        onClick={openCalendarNavPicker}
        title={t("appointments.chooseDateNav")}
        className="max-w-[min(100%,18rem)] truncate rounded px-1.5 py-1 text-center text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {periodTitle}
      </button>
      {!isViewingToday && (
        <button
          type="button"
          onClick={goToday}
          className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          {t("appointments.today")}
        </button>
      )}
      <button
        type="button"
        onClick={navNext}
        aria-label={t("appointments.navNext")}
        className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <NextArrow className={calNavArrowIconClass} />
      </button>
    </div>
  );

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
      <input
        ref={calendarNavDateInputRef}
        type="date"
        className="sr-only"
        value={formatDate(currentDate)}
        onChange={onCalendarNavDateChange}
        aria-hidden
        tabIndex={-1}
      />

      {viewMode !== "day" ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 sm:max-w-xl">{viewModePill}</div>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
            {dateNavRow}
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
            >
              <option value="">
                {t("appointments.filterStaff")}: {t("appointments.allStaff")}
              </option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {viewMode === "day" ? (
        <div
          dir={stripDir}
          className="mb-4 w-full space-y-4 rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/85"
        >
          <div
            dir="ltr"
            className="flex items-center justify-center gap-1"
            lang={locale === "he" ? "he" : locale === "ar" ? "ar" : "en"}
          >
            <button
              type="button"
              onClick={navPrev}
              aria-label={t("appointments.navPrevious")}
              className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <PrevArrow className={calNavArrowIconClass} />
            </button>
            <button
              type="button"
              dir="auto"
              onClick={openCalendarNavPicker}
              title={t("appointments.chooseDateNav")}
              className="min-w-0 max-w-[min(100%,18rem)] px-2 text-center text-base font-semibold text-zinc-900 hover:text-primary dark:text-zinc-50"
            >
              {dayCardTitleText}
            </button>
            <button
              type="button"
              onClick={navNext}
              aria-label={t("appointments.navNext")}
              className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <NextArrow className={calNavArrowIconClass} />
            </button>
            {!isViewingToday ? (
              <button
                type="button"
                onClick={goToday}
                className="ms-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline"
              >
                {t("appointments.today")}
              </button>
            ) : null}
          </div>

          {dayWorkingHoursLine ? (
            <p className="text-center text-sm text-zinc-600 dark:text-zinc-400" dir="auto">
              {t("appointments.scheduleWorkingHoursLine")
                .replace("{start}", dayWorkingHoursLine.start)
                .replace("{end}", dayWorkingHoursLine.end)}
            </p>
          ) : null}

          {selectedDayAppointmentCount != null ? (
            <div className="flex justify-center">
              <span className="rounded-full bg-[var(--primary)]/18 px-3 py-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {(selectedYmdBusiness === todayYmdBusiness
                  ? t("appointments.scheduleAppointmentsToday")
                  : t("appointments.scheduleAppointmentsThisDay")
                ).replace("{count}", String(selectedDayAppointmentCount))}
              </span>
            </div>
          ) : null}

          {viewModePill}

          <div>
            <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("appointments.selectStaffMember")}
            </p>
            <StaffSelector
              staffList={staffList}
              selected={staffFilter}
              onSelect={setStaffFilter}
              allLabel={t("appointments.allStaff")}
              variant="premium"
              compact
            />
          </div>
          {staffFilter ? (
            <ScheduleDayStrip
              days={dayStripItems}
              dir={stripDir}
              onSelectYmd={(ymd) => {
                setCurrentDate(DateTime.fromISO(ymd, { zone: businessTimeZone }).startOf("day").toJSDate());
              }}
              onOpenDay={(ymd) => openDayMutation.mutate(ymd)}
              pickDayLabel={t("appointments.schedulePickDay")}
              openDayLabel={t("appointments.scheduleOpenDay")}
            />
          ) : null}
        </div>
      ) : null}

      {createMutation.error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {translateApiRequestError(createMutation.error, t, t("appointments.createFailed"))}
        </div>
      )}

      {isLoading ? (
        <AppointmentCalendarSkeleton />
      ) : viewMode === "day" || viewMode === "week" ? (
        <StaffScheduleCalendar
          businessTimeZone={businessTimeZone}
          dates={datesInView}
          staff={calendarStaff}
          appointments={appointmentsForCalendar as ScheduleCalendarAppointment[]}
          overlays={scheduleOverlays}
          locale={locale}
          weekAccordion={viewMode === "week"}
          todayBadgeLabel={t("appointments.today")}
          customerName={customerName}
          formatServiceLine={(apt) => {
            const svc = apt.service?.name ?? "—";
            return `${t("appointments.cardArrivingFor")} ${svc}`;
          }}
          minServiceMinutes={minServiceMinutes}
          debugGapHighlight={calendarDebugGaps}
          overlayBreakTitle={t("appointments.calendarBreak")}
          overlayTimeBlockTitle={t("appointments.calendarTimeBlock")}
          overlayVacationTitle={t("staff.vacation")}
          gridDayRange={viewMode === "day" && staffFilter ? dayCalendarGridRange : null}
          snapToStepMinutes={viewMode === "day" ? 15 : 5}
          visualVariant={viewMode === "day" ? "premium" : "default"}
          centerNowInView={viewMode === "day"}
          onInteractionBlocked={(reason) =>
            toast.error(
              t(reason === "drag" ? "appointments.dragBlockedByBreak" : "appointments.slotBlockedByBreakOrVacation")
            )
          }
          canEdit={Boolean(canCreate)}
          onAppointmentClick={(apt) => setSelectedAppointment(apt as Appointment)}
          onEmptyClick={
            canCreate
              ? (ymd, staffId, minutesFromMidnight) => {
                  const hh = Math.floor(minutesFromMidnight / 60);
                  const mm = minutesFromMidnight % 60;
                  const startTime = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
                  setCreateForm((p) => ({
                    ...p,
                    date: ymd,
                    staffId,
                    startTime,
                    branchId: p.branchId || effectiveBranchId || "",
                  }));
                  setCreateModal(true);
                }
              : undefined
          }
          onAppointmentPatch={
            canCreate
              ? async (id, staffId, startIso, endIso) => {
                  await updateMutation.mutateAsync({
                    id,
                    staffId,
                    startTime: startIso,
                    endTime: endIso,
                  });
                }
              : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <div className="grid grid-cols-7 gap-px bg-zinc-200 dark:bg-zinc-700">
            {(
              [
                "staff.days.sun",
                "staff.days.mon",
                "staff.days.tue",
                "staff.days.wed",
                "staff.days.thu",
                "staff.days.fri",
                "staff.days.sat",
              ] as const
            ).map((key) => (
              <div
                key={key}
                className="bg-zinc-50 p-2 text-center text-sm font-medium dark:bg-zinc-800"
              >
                {t(key)}
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
                      const customerChipClass = customerIdToRowClass(apt.customer?.id);
                      const accent = resolveCustomerEventColor(
                        apt.customer?.id,
                        apt.customer?.tagColor,
                      );
                      const startHhMm = formatHhMmInZone(apt.startTime, businessTimeZone);
                      const staffAvatar = apt.staff ? staffAvatarMap.get(apt.staff.id) : null;
                      return (
                        <div
                          key={apt.id}
                          className={`flex items-center gap-1.5 rounded border-l-[3px] px-2 py-1 text-xs ${customerChipClass}`}
                          style={{ borderLeftColor: accent }}
                          title={`${startHhMm} ${customerName(apt.customer)} - ${apt.service?.name ?? "—"}`}
                        >
                          <StaffAvatar
                            avatarUrl={staffAvatar ?? null}
                            firstName={apt.staff?.firstName ?? ""}
                            lastName={apt.staff?.lastName ?? ""}
                            size="sm"
                            className="h-5 w-5 shrink-0 text-[8px]"
                          />
                          <span className="truncate">
                            {startHhMm}{" "}
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
          businessTimeZone={businessTimeZone}
          onClose={() => setSelectedAppointment(null)}
          onDelete={() => {
            setDeleteModalAppointment(selectedAppointment);
            setSelectedAppointment(null);
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

      {deleteModalAppointment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t("appointments.popupDelete")}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {customerName(deleteModalAppointment.customer)} — {deleteModalAppointment.service?.name ?? "—"}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
                onClick={() => setDeleteModalAppointment(null)}
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                onClick={() => {
                  cancelMutation.mutate(deleteModalAppointment.id);
                  setDeleteModalAppointment(null);
                }}
              >
                {t("appointments.popupDelete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal — portaled above mobile bottom nav (layout paints nav after main) */}
      {createModalPortalReady &&
        createModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex min-h-0 items-start justify-center overflow-y-auto overscroll-contain bg-black/70 px-4 pt-6 pb-[max(6rem,calc(5.75rem+env(safe-area-inset-bottom,0px)))]"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCreateModal(false);
            }}
          >
            <div
              ref={createModalPanelRef}
              className="appointment-create-modal-enter my-6 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              role="dialog"
              aria-modal="true"
              aria-labelledby="appointment-create-title"
              onClick={(e) => e.stopPropagation()}
            >
            <h2 id="appointment-create-title" className="mb-4 text-lg font-semibold">
              {t("appointments.createTitle")}
            </h2>
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
                    type ServiceOpt = { id: string; name: string; durationMinutes?: number };
                    const staffServices = staffList.find((s) => s.id === createForm.staffId)?.staffServices;
                    const serviceList: ServiceOpt[] =
                      staffServices && staffServices.length > 0
                        ? staffServices.map((ss) => ({
                            id: ss.service.id,
                            name: ss.service.name,
                            durationMinutes: ss.durationMinutes,
                          }))
                        : services.map((s) => ({ id: s.id, name: s.name }));
                    return serviceList.map((s) => {
                      const dur =
                        s.durationMinutes != null && Number.isFinite(s.durationMinutes)
                          ? s.durationMinutes
                          : serviceById.get(s.id)?.durationMinutes;
                      const label =
                        dur != null
                          ? t("appointments.serviceWithDuration")
                              .replace("{name}", s.name)
                              .replace("{minutes}", String(dur))
                          : s.name;
                      return (
                        <option key={s.id} value={s.id}>
                          {label}
                        </option>
                      );
                    });
                  })()}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.date")}</label>
                <div className="relative min-h-11">
                  <div
                    className="pointer-events-none flex min-h-11 w-full items-center justify-between rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-start dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    aria-hidden
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
                  </div>
                  <input
                    type="date"
                    value={createForm.date}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        date: e.target.value,
                        startTime: "",
                      }))
                    }
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor={createAppointmentTimeSelectId}>
                  {t("appointments.timeSlot")}
                </label>
                {!createTimeFieldReady ? (
                  <select
                    id={createAppointmentTimeSelectId}
                    disabled
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
                    value=""
                  >
                    <option value="">{t("appointments.selectStaffServiceDateFirst")}</option>
                  </select>
                ) : createAvailabilityLoading ? (
                  <select
                    id={createAppointmentTimeSelectId}
                    disabled
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                    value=""
                  >
                    <option value="">{t("appointments.slotsLoading")}</option>
                  </select>
                ) : createFormTimeOptions.length === 0 ? (
                  <select
                    id={createAppointmentTimeSelectId}
                    disabled
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                    value=""
                  >
                    <option value="">
                      {createForm.date === todayYmdBusinessForCreate
                        ? t("appointments.noSlotsToday")
                        : t("appointments.noSlotsAvailable")}
                    </option>
                  </select>
                ) : (
                  <select
                    id={createAppointmentTimeSelectId}
                    required
                    value={createForm.startTime}
                    onChange={(e) => setCreateForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    <option value="">—</option>
                    {createFormTimeOptions.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("appointments.timeFromListHint")}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("appointments.filterBranch")}</label>
                <select
                  value={createForm.branchId || effectiveBranchId || ""}
                  onChange={(e) => setCreateForm((p) => ({ ...p, branchId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                >
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
                    !createForm.startTime,
                  )}
                  className="flex-1"
                >
                  {t("appointments.add")}
                </LoadingButton>
              </div>
            </form>
            </div>
          </div>,
          document.body,
        )}

      {canCreate && (
        <ScheduleCalendarFab
          dir={stripDir}
          items={[
            {
              key: "book",
              icon: <FabIcons.CalendarPlus className="h-4 w-4" />,
              label: t("appointments.fabNewBooking"),
              onClick: () => {
                setCreateForm((p) => ({
                  ...p,
                  date: selectedYmdBusiness,
                  staffId: p.staffId || staffFilter || "",
                  branchId: p.branchId || effectiveBranchId || "",
                }));
                setCreateModal(true);
              },
            },
            {
              key: "block",
              icon: <FabIcons.Clock className="h-4 w-4" />,
              label: t("appointments.fabBlockTime"),
              onClick: () => {
                if (!staffFilter) {
                  toast.error(t("appointments.blockTimeNeedStaff"));
                  return;
                }
                setBlockTimeOpen(true);
              },
            },
            {
              key: "walkin",
              icon: <FabIcons.Scissors className="h-4 w-4" />,
              label: t("appointments.fabWalkIn"),
              onClick: () => {
                setCreateForm((p) => ({
                  ...p,
                  date: selectedYmdBusiness,
                  staffId: p.staffId || staffFilter || "",
                  branchId: p.branchId || effectiveBranchId || "",
                }));
                setCreateModal(true);
              },
            },
            {
              key: "schedule",
              icon: <FabIcons.Settings2 className="h-4 w-4" />,
              label: t("appointments.fabEditSchedule"),
              onClick: () => router.push("/admin/breaks"),
            },
          ]}
        />
      )}

      <BlockTimeDialog
        open={blockTimeOpen}
        onClose={() => setBlockTimeOpen(false)}
        businessId={businessId!}
        staffId={staffFilter}
        dateYmd={selectedYmdBusiness}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: ["staff", "breaks", "admin", businessId] })
        }
        title={t("appointments.blockTimeTitle")}
        startLabel={t("appointments.blockTimeStart")}
        endLabel={t("appointments.blockTimeEnd")}
        cancelLabel={t("customers.cancel")}
        saveLabel={t("appointments.blockTimeSave")}
        successToast={t("appointments.blockTimeSaved")}
      />

      <RemoveTimeBlocksDialog
        open={removeTimeBlocksOpen}
        onClose={() => setRemoveTimeBlocksOpen(false)}
        businessId={businessId!}
        items={timeBlockExceptionsForSelectedDay}
        dateHeading={dayCardTitleText}
        title={t("appointments.removeTimeBlocksTitle")}
        emptyLabel={t("appointments.removeTimeBlocksEmpty")}
        removeLabel={t("appointments.removeTimeBlocksRemove")}
        removedToast={t("appointments.removeTimeBlocksRemoved")}
        closeLabel={t("customers.cancel")}
      />
    </div>
  );
}
