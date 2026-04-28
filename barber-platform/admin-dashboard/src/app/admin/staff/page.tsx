"use client";

import Link from "next/link";
import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, apiUpload } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useLocaleStore } from "@/stores/locale-store";
import { translateApiError } from "@/lib/i18n";
import toast from "react-hot-toast";
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  UserPlus,
  Camera,
  Clock,
  Coffee,
  CalendarOff,
  Scissors,
} from "lucide-react";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { BirthDateTripleInput } from "@/components/ui/birth-date-triple-input";
import { GenderToggle, type GenderToggleValue } from "@/components/ui/gender-toggle";
import { StaffWeeklyHoursPanel } from "@/components/staff/StaffWeeklyHoursPanel";
import { EmployeePerformanceDashboard } from "@/components/staff/profile/employee-performance-dashboard";
import { formatYmdLocal, addDaysLocal } from "@/lib/local-ymd";
import { formatLongWeekdayDateYmd } from "@/lib/locale-display";

const DAYS = [
  { d: 0, key: "staff.days.sun" },
  { d: 1, key: "staff.days.mon" },
  { d: 2, key: "staff.days.tue" },
  { d: 3, key: "staff.days.wed" },
  { d: 4, key: "staff.days.thu" },
  { d: 5, key: "staff.days.fri" },
  { d: 6, key: "staff.days.sat" },
];

/** Matches backend default schedule for new staff (Mon–Fri). */
const DEFAULT_WORKING_HOURS: Record<number, { start: string; end: string }> = {
  1: { start: "09:00", end: "18:00" },
  2: { start: "09:00", end: "18:00" },
  3: { start: "09:00", end: "18:00" },
  4: { start: "09:00", end: "18:00" },
  5: { start: "09:00", end: "18:00" },
};

export interface StaffServiceItem {
  id: string;
  durationMinutes: number;
  price: number;
  service: { id: string; name: string };
}

/** תגובת GET /staff/schedule-snapshot — לדיבוג קונסול בדף צוות */
export interface StaffScheduleSnapshot {
  generatedAt: string;
  businessId: string;
  branchId: string | null;
  anchorFirstWeekdayYmd: string;
  daysComputed: number;
  staffCount: number;
  staff: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    branch: { id: string; name: string } | null;
    isActive: boolean;
    workingHoursByDay: Array<{
      dayOfWeek: number;
      dayLabelHe: string;
      startTime: string;
      endTime: string;
    }>;
    breaksByDay: Array<{
      dayOfWeek: number;
      dayLabelHe: string;
      startTime: string;
      endTime: string;
    }>;
    /** staff_break_exceptions inside snapshot date window (not the recurring weekly table). */
    breakExceptionsInWindow: Array<{ date: string; startTime: string; endTime: string }>;
    timeOff: Array<{
      id: string;
      startDate: string;
      endDate: string;
      isAllDay: boolean;
      startTime: string | null;
      endTime: string | null;
      reason: string | null;
    }>;
    servicesAvailability: Array<{
      serviceId: string;
      serviceName: string;
      perDay: Array<{ date: string; slotCount: number; slots: string[] }>;
      totalSlotOptions: number;
    }>;
    summary: {
      servicesWithBooking: number;
      totalSlotOptionsAllServices: number;
    };
  }>;
}

/** GET /staff/:id/breaks — weekly rows + per-date exceptions */
type StaffBreaksWindowResponse = {
  weeklyBreaks: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
  exceptions: { id: string; date: string; startTime: string; endTime: string }[];
};

export interface StaffMember {
  id: string;
  businessId: string;
  branchId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  instagram: string | null;
  facebook: string | null;
  whatsapp: string | null;
  isActive: boolean;
  monthlyTargetRevenue?: number | null;
  birthDate?: string | null;
  gender?: string | null;
  branch?: { id: string; name: string } | null;
  staffServices?: StaffServiceItem[];
  staffWorkingHours?: { dayOfWeek: number; startTime: string; endTime: string }[];
  staffBreaks?: { id?: string; dayOfWeek: number; startTime: string; endTime: string }[];
  staffTimeOff?: { id?: string; startDate: string; endDate: string; reason: string | null }[];
  businessRoleSlug?: string | null;
}

interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
  bio: string;
  instagram: string;
  facebook: string;
  whatsapp: string;
  branchId: string;
  monthlyTargetRevenue: string;
  birthDate: string;
  gender: GenderToggleValue;
}

type EarningsAppointment = {
  id: string;
  startTime: string;
  status?: string;
  service?: {
    name?: string | null;
    price?: number | string | null;
  } | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  payment?: {
    amount?: number | string | null;
    status?: string | null;
  } | null;
  totalAmount?: number | string | null;
  finalPrice?: number | string | null;
  price?: number | string | null;
  revenueUsed?: number | string | null;
};

type StaffEarningsSummaryResponse = {
  staffId: string;
  fromDate: string;
  toDate: string;
  settlementModel: "boothRental" | "percentage" | "fixedPerTreatment";
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
  previousPeriodComparison?: {
    fromDate: string;
    toDate: string;
    completedAppointmentsCount: number;
    totalRevenue: number;
    grossEarnings: number;
    finalPayable: number;
    revenueDeltaPercent: number | null;
    completedDeltaPercent: number | null;
    payableDeltaPercent: number | null;
  };
  settlementConfig?: {
    model: "boothRental" | "percentage" | "fixedPerTreatment";
    boothRentalAmount?: number;
    businessCutPercent?: number;
    fixedAmountPerTreatment?: number;
    allowNegativeBalance?: boolean;
  };
  eligibleAppointments: EarningsAppointment[];
};

function branchDisplayName(name: string | null | undefined, t: (k: string) => string): string {
  if (!name) return "—";
  return name === "Main Branch" ? t("branches.mainBranch") : name;
}

function defaultStaffBreakExceptionRange(): { start: string; end: string } {
  const start = formatYmdLocal(new Date());
  return { start, end: addDaysLocal(start, 179) };
}

function startOfMonthYmdLocal(base = new Date()): string {
  return formatYmdLocal(new Date(base.getFullYear(), base.getMonth(), 1));
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function appointmentRevenue(a: EarningsAppointment): number {
  return safeNumber(
    a.revenueUsed ??
    a.payment?.amount ??
      a.totalAmount ??
      a.finalPrice ??
      a.price ??
      a.service?.price ??
      0
  );
}

function toCsvCell(v: string | number): string {
  const raw = String(v ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

export default function AdminStaffPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const dir = useLocaleStore((s) => s.dir);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const selectedBranchId = useEffectiveBranchId(businessId);
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"add" | "edit" | "invite" | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setActiveTab] = useState<"profile" | "schedule" | "services">("profile");
  const [detailTab, setDetailTab] = useState<"hours" | "breaks" | "timeoff" | "services">("hours");
  const [dayEnabled, setDayEnabled] = useState<Record<number, boolean>>({});
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  const [savingScheduleExtras, setSavingScheduleExtras] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<ProfileForm>({
    firstName: "",
    lastName: "",
    phone: "",
    bio: "",
    instagram: "",
    facebook: "",
    whatsapp: "",
    branchId: "",
    monthlyTargetRevenue: "",
    birthDate: "",
    gender: "",
  });

  const [workingHours, setWorkingHours] = useState<
    Record<number, { start: string; end: string }>
  >({});
  const [breaks, setBreaks] = useState<
    { id?: string; dayOfWeek: number; startTime: string; endTime: string }[]
  >([]);
  const [timeOff, setTimeOff] = useState<
    { id?: string; startDate: string; endDate: string; reason: string }[]
  >([]);
  const [editingService, setEditingService] = useState<StaffServiceItem | null>(null);
  const [serviceDuration, setServiceDuration] = useState(30);
  const [servicePrice, setServicePrice] = useState(0);
  const [addServiceId, setAddServiceId] = useState("");
  const [showNewServiceForm, setShowNewServiceForm] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [staffBreakExceptionRange, setStaffBreakExceptionRange] = useState(defaultStaffBreakExceptionRange);
  const [selectedBreakExceptionIds, setSelectedBreakExceptionIds] = useState<string[]>([]);
  const [earningsRangeStart, setEarningsRangeStart] = useState(startOfMonthYmdLocal());
  const [earningsRangeEnd, setEarningsRangeEnd] = useState(formatYmdLocal(new Date()));

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: String(showInactive),
    excludeManagers: "false",
  });
  if (selectedBranchId) queryParams.set("branchId", selectedBranchId);

  const { data: staffListRaw = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ["staff", businessId, showInactive, selectedBranchId],
    queryFn: () =>
      apiClient<StaffMember[]>(`/staff?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  /** הפסקות לפי תאריך — אותו מפתח query כמו בדף ההפסקות כדי שינוי/מחיקה יסנכרן */
  const staffBreakRangeStart = staffBreakExceptionRange.start;
  const staffBreakRangeEnd = staffBreakExceptionRange.end;
  const { data: staffBreaksWindow } = useQuery<StaffBreaksWindowResponse>({
    queryKey: ["staff", selectedStaffId, "breaks", staffBreakRangeStart, staffBreakRangeEnd],
    queryFn: () =>
      apiClient<StaffBreaksWindowResponse>(
        `/staff/${selectedStaffId}/breaks?businessId=${encodeURIComponent(
          businessId!
        )}&startDate=${staffBreakRangeStart}&endDate=${staffBreakRangeEnd}`
      ),
    enabled: !!businessId && !!selectedStaffId && staffBreakRangeStart <= staffBreakRangeEnd,
  });

  useEffect(() => {
    setStaffBreakExceptionRange(defaultStaffBreakExceptionRange());
    setSelectedBreakExceptionIds([]);
  }, [selectedStaffId]);

  useEffect(() => {
    setSelectedBreakExceptionIds([]);
  }, [staffBreakRangeStart, staffBreakRangeEnd]);

  const deleteBreakExceptionMutation = useMutation({
    mutationFn: (exceptionId: string) =>
      apiClient(
        `/staff/breaks/exception/${exceptionId}?staffId=${selectedStaffId}&businessId=${encodeURIComponent(
          businessId || ""
        )}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff", selectedStaffId, "breaks"] });
      void queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      toast.success(t("breaks.deleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const bulkDeleteBreakExceptionsMutation = useMutation({
    mutationFn: async (exceptionIds: string[]) => {
      if (!selectedStaffId || !businessId) return;
      await Promise.all(
        exceptionIds.map((exceptionId) =>
          apiClient(
            `/staff/breaks/exception/${exceptionId}?staffId=${selectedStaffId}&businessId=${encodeURIComponent(
              businessId
            )}`,
            { method: "DELETE" }
          )
        )
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff", selectedStaffId, "breaks"] });
      void queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setSelectedBreakExceptionIds([]);
      toast.success(t("breaks.bulkDeleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  /** דיבוג: רשימת עובדים, שעות, וסלוטים מהשרת (אותו נתונים כמו בטסט לוגיקלית) */
  useEffect(() => {
    if (!businessId || staffListRaw.length === 0) return;
    console.log(
      "%c[צוות] רשימת עובדים (מ-GET /staff)",
      "color: #0ea5e9; font-weight: bold",
      staffListRaw.map((s) => ({
        id: s.id,
        שם: `${s.firstName} ${s.lastName}`,
        אימייל: s.email,
        טלפון: s.phone,
        סניף: s.branch?.name ?? null,
        שעות_עבודה_לפי_יום: (s.staffWorkingHours ?? []).map((h) => ({
          יום: DAYS.find((x) => x.d === h.dayOfWeek)?.key ?? h.dayOfWeek,
          התחלה: h.startTime,
          סוף: h.endTime,
        })),
        הפסקות: s.staffBreaks ?? [],
        חופש_באישור: s.staffTimeOff ?? [],
        שירותים: (s.staffServices ?? []).map((ss) => ({
          שם: ss.service.name,
          משך_דקות: ss.durationMinutes,
        })),
      })),
    );

    const snapQs = new URLSearchParams({ businessId });
    if (selectedBranchId) snapQs.set("branchId", selectedBranchId);
    void apiClient<StaffScheduleSnapshot>(`/staff/schedule-snapshot?${snapQs.toString()}`)
      .then((snap) => {
        console.log(
          "%c[צוות] צילום זמינות (GET /staff/schedule-snapshot)",
          "color: #22c55e; font-weight: bold",
          `עיגון: ${snap.anchorFirstWeekdayYmd} · ${snap.daysComputed} ימים · ${snap.staffCount} עובדים`,
        );
        console.log("[צוות] אובייקט מלא:", snap);
        for (const s of snap.staff) {
          console.log(
            `%c${s.firstName} ${s.lastName}`,
            "font-weight: bold",
            "| סה\"כ אפשרויות סלוט בכל השירותים:",
            s.summary.totalSlotOptionsAllServices,
            "| שירותים להזמנה:",
            s.summary.servicesWithBooking,
          );
          console.log("  ימים עם שעות עבודה:", s.workingHoursByDay);
          console.log("  הפסקות שבועיות (staff_breaks):", s.breaksByDay);
          console.log("  הפסקות לפי תאריך בחלון:", s.breakExceptionsInWindow ?? []);
          console.log("  סלוטים לפי שירות:", s.servicesAvailability);
        }
      })
      .catch((err) => {
        console.warn("[צוות] schedule-snapshot נכשל (הרשאות/רשת):", err);
      });
  }, [businessId, selectedBranchId, staffListRaw]);

  const staffList = searchQuery.trim()
    ? staffListRaw.filter(
        (s) =>
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.phone?.includes(searchQuery.replace(/\D/g, ""))
      )
    : staffListRaw;

  const selectedStaff = useMemo(
    () => staffList.find((s) => s.id === selectedStaffId) ?? null,
    [staffList, selectedStaffId]
  );

  useEffect(() => {
    if (selectedStaffId && !staffList.some((s) => s.id === selectedStaffId)) {
      setSelectedStaffId(null);
    }
  }, [staffList, selectedStaffId]);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  type PendingInvite = { id: string; phone: string; createdAt: string; expiresAt: string; branch?: { id: string; name: string } | null };
  const { data: pendingInvites = [] } = useQuery<PendingInvite[]>({
    queryKey: ["staff-invites", businessId],
    queryFn: () =>
      apiClient<PendingInvite[]>(`/business/staff-invites?businessId=${businessId}`),
    enabled: !!businessId && isAdmin,
    refetchInterval: 15000,
  });

  const servicesParams = new URLSearchParams({ businessId: businessId || "" });
  if (selectedStaff?.branchId) servicesParams.set("branchId", selectedStaff.branchId);
  const { data: servicesList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["services", businessId, selectedStaff?.branchId, detailTab],
    queryFn: () =>
      apiClient<{ id: string; name: string }[]>(`/services?${servicesParams.toString()}`),
    enabled: !!businessId && !!selectedStaff && detailTab === "services",
  });

  const { data: earningsSummary } = useQuery<StaffEarningsSummaryResponse>({
    queryKey: [
      "staff-earnings-summary",
      businessId,
      selectedStaff?.id,
      selectedBranchId,
      earningsRangeStart,
      earningsRangeEnd,
    ],
    queryFn: () =>
      apiClient<StaffEarningsSummaryResponse>(
        `/staff/${selectedStaff?.id}/earnings-summary?businessId=${businessId}&fromDate=${earningsRangeStart}&toDate=${earningsRangeEnd}&compareWithPreviousPeriod=true`,
      ),
    enabled:
      !!businessId &&
      !!selectedStaff?.id &&
      !!earningsRangeStart &&
      !!earningsRangeEnd &&
      earningsRangeStart <= earningsRangeEnd,
  });

  const earningsAppointments = earningsSummary?.eligibleAppointments ?? [];
  const treatmentsCount = earningsSummary?.completedAppointmentsCount ?? 0;
  const totalRevenue = earningsSummary?.totalRevenue ?? 0;

  function initDayEnabledFromHours(wh: Record<number, { start: string; end: string }>) {
    const e: Record<number, boolean> = {};
    for (let d = 0; d <= 6; d++) {
      e[d] = !!(wh[d]?.start && wh[d]?.end);
    }
    return e;
  }

  function loadScheduleFromStaff(staff: StaffMember) {
    const wh: Record<number, { start: string; end: string }> = {};
    for (const h of staff.staffWorkingHours || []) {
      wh[h.dayOfWeek] = { start: h.startTime, end: h.endTime };
    }
    setWorkingHours(wh);
    setDayEnabled(initDayEnabledFromHours(wh));
    setBreaks(
      (staff.staffBreaks || []).map((b) => ({
        id: (b as { id?: string }).id,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
      }))
    );
    setTimeOff(
      (staff.staffTimeOff || []).map((to) => ({
        id: (to as { id?: string }).id,
        startDate: to.startDate.split("T")[0],
        endDate: to.endDate.split("T")[0],
        reason: to.reason ?? "",
      }))
    );
  }

  async function saveWorkingHoursBatchRequest(staffId: string) {
    if (!businessId) return;
    const days: { dayOfWeek: number; startTime: string; endTime: string }[] = [];
    for (let d = 0; d <= 6; d++) {
      if (dayEnabled[d] === false) continue;
      const h = workingHours[d];
      if (h?.start && h?.end) {
        days.push({ dayOfWeek: d, startTime: h.start, endTime: h.end });
      }
    }
    await apiClient("/staff/working-hours/batch", {
      method: "POST",
      body: JSON.stringify({ staffId, businessId, days }),
    });
  }

  async function saveBreaksAndTimeOffOnly(staffId: string) {
    for (const b of breaks) {
      if (b.id) continue;
      await apiClient("/staff/breaks", {
        method: "POST",
        body: JSON.stringify({
          staffId,
          businessId,
          dayOfWeek: b.dayOfWeek,
          startTime: b.startTime,
          endTime: b.endTime,
        }),
      });
    }
    for (const to of timeOff) {
      if (to.id) continue;
      await apiClient("/staff/time-off", {
        method: "POST",
        body: JSON.stringify({
          staffId,
          businessId,
          startDate: to.startDate,
          endDate: to.endDate,
          reason: to.reason || undefined,
        }),
      });
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: ProfileForm) =>
      apiClient<StaffMember>("/staff", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          branchId: data.branchId,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || undefined,
          bio: data.bio || undefined,
          instagram: data.instagram || undefined,
          facebook: data.facebook || undefined,
          whatsapp: data.whatsapp || undefined,
          birthDate: data.birthDate || undefined,
          gender:
            data.gender === "MALE" || data.gender === "FEMALE" || data.gender === "OTHER"
              ? data.gender
              : undefined,
        }),
      }),
    onSuccess: async (staff) => {
      await saveWorkingHoursBatchRequest(staff.id);
      await saveBreaksAndTimeOffOnly(staff.id);
      await queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      const full = await apiClient<StaffMember>(`/staff/${staff.id}`);
      loadScheduleFromStaff(full);
      setSelectedStaffId(staff.id);
      setModal(null);
      setEditing(null);
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        bio: "",
        instagram: "",
        facebook: "",
        whatsapp: "",
        branchId: "",
        monthlyTargetRevenue: "",
        birthDate: "",
        gender: "",
      });
      setActiveTab("profile");
      toast.success(t("widget.saved"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, omitPhone }: { id: string; data: ProfileForm; omitPhone?: boolean }) =>
      apiClient<StaffMember>(`/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          branchId: data.branchId || undefined,
          firstName: data.firstName,
          lastName: data.lastName,
          ...(omitPhone ? {} : { phone: data.phone || undefined }),
          bio: data.bio || undefined,
          instagram: data.instagram || undefined,
          facebook: data.facebook || undefined,
          whatsapp: data.whatsapp || undefined,
          monthlyTargetRevenue: data.monthlyTargetRevenue ? parseFloat(data.monthlyTargetRevenue) : undefined,
          birthDate: data.birthDate ? data.birthDate : null,
          gender:
            data.gender === "MALE" || data.gender === "FEMALE" || data.gender === "OTHER"
              ? data.gender
              : null,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      setEditing(null);
      toast.success(t("widget.saved"));
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<StaffMember>(`/staff/${id}/deactivate`, {
        method: "PATCH",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      setEditing(null);
    },
  });

  const inviteByPhoneMutation = useMutation({
    mutationFn: (phone: string) =>
      apiClient<{ success: boolean; message: string }>("/business/invite-staff-by-phone", {
        method: "POST",
        body: JSON.stringify({ businessId, phone }),
      }),
    onSuccess: (_, phone) => {
      queryClient.invalidateQueries({ queryKey: ["staff-invites", businessId] });
      toast.success(`הזמנה נשלחה ל־${phone}. העובד יתחבר וישלים רישום.`);
      setModal(null);
      setInvitePhone("");
    },
  });

  const updateStaffServicesMutation = useMutation({
    mutationFn: ({ staffId, updates }: { staffId: string; updates: { staffServiceId: string; durationMinutes?: number; price?: number }[] }) =>
      apiClient<StaffMember>(`/staff/${staffId}/services`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, updates }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setEditingService(null);
      if (data.id === selectedStaffId) loadScheduleFromStaff(data);
      setEditing((prev) => (prev?.id === data.id ? data : prev));
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addStaffServiceMutation = useMutation({
    mutationFn: ({ staffId, serviceId, durationMinutes, price }: { staffId: string; serviceId: string; durationMinutes?: number; price?: number }) =>
      apiClient<StaffMember>(`/staff/${staffId}/services`, {
        method: "POST",
        body: JSON.stringify({ businessId, serviceId, durationMinutes, price }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setAddServiceId("");
      if (data.id === selectedStaffId) loadScheduleFromStaff(data);
      setEditing((prev) => (prev?.id === data.id ? data : prev));
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeStaffServiceMutation = useMutation({
    mutationFn: ({ staffId, staffServiceId }: { staffId: string; staffServiceId: string }) =>
      apiClient<StaffMember>(`/staff/${staffId}/services/${staffServiceId}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      if (data.id === selectedStaffId) loadScheduleFromStaff(data);
      setEditing((prev) => (prev?.id === data.id ? data : prev));
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createAndAssignServiceMutation = useMutation({
    mutationFn: async ({ staffId, branchId, name, durationMinutes, price }: { staffId: string; branchId: string; name: string; durationMinutes: number; price: number }) => {
      const svc = await apiClient<{ id: string }>("/services", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          branchId,
          name: name.trim(),
          durationMinutes,
          price,
        }),
      });
      return apiClient<StaffMember>(`/staff/${staffId}/services`, {
        method: "POST",
        body: JSON.stringify({ businessId, serviceId: svc.id, durationMinutes, price }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setShowNewServiceForm(false);
      setNewServiceName("");
      if (data.id === selectedStaffId) loadScheduleFromStaff(data);
      setEditing((prev) => (prev?.id === data.id ? data : prev));
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<StaffMember>(`/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, isActive: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<{ success: boolean }>(`/staff/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      setEditing(null);
    },
  });

  const photoUploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("photo", file);
      return apiUpload<StaffMember>(
        `/staff/${id}/photo?businessId=${businessId}`,
        fd
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      if (editing) {
        setEditing((p) => (p ? { ...p, avatarUrl: p.avatarUrl } : null));
      }
    },
  });

  async function handleSaveWorkingHours() {
    if (!selectedStaffId || !businessId) return;
    setSavingHours(true);
    try {
      await saveWorkingHoursBatchRequest(selectedStaffId);
      await queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      const full = await apiClient<StaffMember>(`/staff/${selectedStaffId}`);
      loadScheduleFromStaff(full);
      toast.success(t("widget.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingHours(false);
    }
  }

  async function handleSaveScheduleExtras() {
    if (!selectedStaffId) return;
    setSavingScheduleExtras(true);
    try {
      await saveBreaksAndTimeOffOnly(selectedStaffId);
      await queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["staff", selectedStaffId, "breaks"] });
      const full = await apiClient<StaffMember>(`/staff/${selectedStaffId}`);
      loadScheduleFromStaff(full);
      toast.success(t("widget.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingScheduleExtras(false);
    }
  }

  const resetForm = () => {
    setForm({
      firstName: "",
      lastName: "",
      phone: "",
      bio: "",
      instagram: "",
      facebook: "",
      whatsapp: "",
      branchId: "",
      monthlyTargetRevenue: "",
      birthDate: "",
      gender: "",
    });
    setWorkingHours({});
    setDayEnabled({});
    setBreaks([]);
    setTimeOff([]);
    setActiveTab("profile");
    setEditingService(null);
    setAddServiceId("");
    setShowNewServiceForm(false);
    setNewServiceName("");
  };

  const openAdd = () => {
    setForm({
      firstName: "",
      lastName: "",
      phone: "",
      bio: "",
      instagram: "",
      facebook: "",
      whatsapp: "",
      branchId: branches.length === 1 ? branches[0].id : "",
      monthlyTargetRevenue: "",
      birthDate: "",
      gender: "",
    });
    setWorkingHours({ ...DEFAULT_WORKING_HOURS });
    setDayEnabled(initDayEnabledFromHours(DEFAULT_WORKING_HOURS));
    setBreaks([]);
    setTimeOff([]);
    setActiveTab("profile");
    setEditing(null);
    setModal("add");
  };

  const openEdit = (staff: StaffMember) => {
    setForm({
      firstName: staff.firstName,
      lastName: staff.lastName,
      phone: staff.phone ?? "",
      bio: staff.bio ?? "",
      instagram: staff.instagram ?? "",
      facebook: staff.facebook ?? "",
      whatsapp: staff.whatsapp ?? "",
      branchId: staff.branchId ?? "",
      monthlyTargetRevenue: staff.monthlyTargetRevenue != null ? String(staff.monthlyTargetRevenue) : "",
      birthDate: staff.birthDate ? staff.birthDate.slice(0, 10) : "",
      gender:
        staff.gender === "MALE" || staff.gender === "FEMALE" || staff.gender === "OTHER"
          ? staff.gender
          : "",
    });
    loadScheduleFromStaff(staff);
    setSelectedStaffId(staff.id);
    setDetailTab("hours");
    setEditing(staff);
    setModal("edit");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.branchId && branches.length > 0) {
      toast.error(t("staff.selectBranch"));
      return;
    }
    if (modal === "add") {
      createMutation.mutate(form);
    } else if (modal === "edit" && editing) {
      updateMutation.mutate({ id: editing.id, data: form, omitPhone: true });
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editing) {
      photoUploadMutation.mutate({ id: editing.id, file });
    }
    e.target.value = "";
  };

  const addBreak = () =>
    setBreaks((p) => [...p, { dayOfWeek: 0, startTime: "12:00", endTime: "13:00" }]);
  const removeBreak = (i: number) =>
    setBreaks((p) => p.filter((_, idx) => idx !== i));
  const addTimeOff = () =>
    setTimeOff((p) => [
      ...p,
      {
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        reason: "vacation",
      },
    ]);
  const removeTimeOff = (i: number) =>
    setTimeOff((p) => p.filter((_, idx) => idx !== i));

  const getPhotoUrl = (url: string | null) => {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    const base = process.env.NEXT_PUBLIC_API_URL;
    return base && base !== "" ? `${base}${url}` : url;
  };

  const hasBookableWorkingHours = useMemo(() => {
    for (let d = 0; d <= 6; d++) {
      if (dayEnabled[d] === false) continue;
      const h = workingHours[d];
      if (h?.start && h?.end) return true;
    }
    return false;
  }, [workingHours, dayEnabled]);

  const currencyFormatter = useMemo(() => {
    return new Intl.NumberFormat(
      locale === "he" ? "he-IL" : locale === "ar" ? "ar-SA" : "en-US",
      { style: "currency", currency: "ILS", maximumFractionDigits: 0 }
    );
  }, [locale]);

  function downloadStaffCsvReport() {
    if (!selectedStaff) return;
    const header = [
      "appointment_id",
      "start_time",
      "service",
      "customer_name",
      "customer_phone",
      "revenue",
    ];
    const rows = earningsAppointments.map((a) => {
      const fullName = `${a.customer?.firstName ?? ""} ${a.customer?.lastName ?? ""}`.trim();
      return [
        a.id,
        a.startTime,
        a.service?.name ?? "",
        fullName,
        a.customer?.phone ?? "",
        appointmentRevenue(a).toFixed(2),
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((v) => toCsvCell(v)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `staff-report-${selectedStaff.id}-${earningsRangeStart}-${earningsRangeEnd}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  function printStaffPdfReport() {
    if (!selectedStaff) return;
    const reportTitle = `${selectedStaff.firstName} ${selectedStaff.lastName}`;
    const html = `
      <html>
        <head>
          <title>${reportTitle} Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 16px; color: #444; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-bottom: 16px; }
            .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; }
            .label { font-size: 12px; color: #666; }
            .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border-bottom: 1px solid #eee; text-align: left; padding: 8px; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>${reportTitle}</h1>
          <p>${earningsRangeStart} - ${earningsRangeEnd}</p>
          <div class="grid">
            <div class="card"><div class="label">${t("employeeDashboard.kpi.treatments")}</div><div class="value">${treatmentsCount}</div></div>
            <div class="card"><div class="label">${t("employeeDashboard.kpi.revenue")}</div><div class="value">${currencyFormatter.format(totalRevenue)}</div></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Start</th>
                <th>Service</th>
                <th>Customer</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              ${earningsAppointments
                .slice(0, 50)
                .map((a) => {
                  const fullName = `${a.customer?.firstName ?? ""} ${a.customer?.lastName ?? ""}`.trim();
                  return `<tr><td>${a.id}</td><td>${a.startTime}</td><td>${a.service?.name ?? ""}</td><td>${fullName}</td><td>${appointmentRevenue(a).toFixed(2)}</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;
    const w = window.open("", "_blank", "noopener,noreferrer,width=980,height=760");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.staff")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view staff.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.staff")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("widget.loading")}</p>
      </div>
    );
  }

  const err =
    createMutation.error ??
    updateMutation.error ??
    deleteMutation.error ??
    deactivateMutation.error ??
    activateMutation.error ??
    inviteByPhoneMutation.error;
  const rawErrMsg = err instanceof Error ? err.message : err ? String(err) : "";
  const errMsg = rawErrMsg ? translateApiError(locale, rawErrMsg) : "";

  return (
    <div dir={dir}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("staff.managementTitle")}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t("staff.managementSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder={t("staff.search") ?? "Search employees..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("staff.showInactive")}
          </label>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setModal("invite"); setInvitePhone(""); }}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                הזמן לפי טלפון
              </button>
              <button
                type="button"
                onClick={openAdd}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                {t("staff.add")}
              </button>
            </div>
          )}
        </div>
      </div>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {errMsg}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <h2 className="mb-3 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
            <UserPlus className="h-5 w-5" />
            {t("staff.pendingInvites")}
          </h2>
          <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
            {t("staff.pendingInvitesDesc")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-200 dark:border-amber-800">
                  <th className="pb-2 text-right font-medium text-amber-800 dark:text-amber-200">
                    {t("staff.phone")}
                  </th>
                  <th className="pb-2 text-right font-medium text-amber-800 dark:text-amber-200">
                    {t("staff.inviteSentAt")}
                  </th>
                  {branches.length > 1 && (
                    <th className="pb-2 text-right font-medium text-amber-800 dark:text-amber-200">
                      {t("staff.branch")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-amber-100 dark:border-amber-900/30"
                  >
                    <td className="py-2 font-medium">{inv.phone}</td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">
                      {new Date(inv.createdAt).toLocaleString(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    {branches.length > 1 && (
                      <td className="py-2 text-zinc-600 dark:text-zinc-400">
                        {branchDisplayName(inv.branch?.name, t)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {staffList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">{t("staff.empty")}</p>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              {t("staff.addFirst")}
            </button>
          )}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-5">
          <aside className="w-full min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t("staff.managementTeamList")}
              </p>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {staffList.length}
              </span>
            </div>
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max items-start gap-3">
                {staffList.map((staff) => {
                  const isSelected = selectedStaffId === staff.id;
                  return (
                    <button
                      key={staff.id}
                      type="button"
                      onClick={() => {
                        setSelectedStaffId(staff.id);
                        loadScheduleFromStaff(staff);
                        setDetailTab("hours");
                      }}
                      className={`group flex w-[110px] shrink-0 flex-col items-center gap-2 rounded-2xl border px-3 py-3 text-center transition-all ${
                        isSelected
                          ? "border-violet-400 bg-violet-50 shadow-md dark:border-violet-500 dark:bg-violet-950/30"
                          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                      }`}
                    >
                      <StaffAvatar
                        avatarUrl={staff.avatarUrl}
                        firstName={staff.firstName}
                        lastName={staff.lastName}
                        size="lg"
                        className="ring-2 ring-white dark:ring-zinc-900"
                      />
                      <div className="w-full">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {staff.firstName} {staff.lastName}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {branchDisplayName(staff.branch?.name, t)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex h-2 w-2 rounded-full ${
                          staff.isActive ? "bg-emerald-500" : "bg-zinc-400"
                        }`}
                        aria-label={staff.isActive ? "active" : "inactive"}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <section className="w-full min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/30 p-5 dark:border-zinc-700/80 dark:bg-zinc-950/20 lg:p-6">
            {selectedStaff ? (
              <>
                <div className="mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {selectedStaff.firstName} {selectedStaff.lastName}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      {branchDisplayName(selectedStaff.branch?.name, t)}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedStaff.isActive) {
                            if (confirm(t("staff.confirmDeactivate"))) deactivateMutation.mutate(selectedStaff.id);
                          } else {
                            activateMutation.mutate(selectedStaff.id);
                          }
                        }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                          selectedStaff.isActive
                            ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                        }`}
                      >
                        <Power className="h-4 w-4" />
                        {selectedStaff.isActive ? t("staff.deactivate") : t("staff.activate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(selectedStaff)}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-white dark:border-zinc-600 dark:hover:bg-zinc-800"
                      >
                        <Pencil className="h-4 w-4" />
                        {t("staff.editProfile")}
                      </button>
                        <button
                          type="button"
                          onClick={() => {
                          if (confirm(`${t("staff.confirmDelete")}\n\n${t("employeeDashboard.staffDeletedHint")}`)) {
                            deleteMutation.mutate(selectedStaff.id);
                          }
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("staff.delete")}
                      </button>
                    </div>
                  )}
                </div>

                <EmployeePerformanceDashboard
                  key={selectedStaff.id}
                  profile={{
                    id: selectedStaff.id,
                    fullName: `${selectedStaff.firstName} ${selectedStaff.lastName}`,
                    roleLabel: selectedStaff.businessRoleSlug ? t(`role.${selectedStaff.businessRoleSlug}`) : t("staff.roleManager"),
                    statusLabel: selectedStaff.isActive
                      ? t("employeeDashboard.status.active")
                      : t("employeeDashboard.status.inactive"),
                    statusTone: selectedStaff.isActive ? "active" : "inactive",
                    avatarUrl: getPhotoUrl(selectedStaff.avatarUrl),
                    settlementModel: earningsSummary?.settlementModel ?? "percentage",
                  }}
                  isRtl={dir === "rtl"}
                  earningsSummary={earningsSummary ?? null}
                  monthlyTargetRevenue={Math.max(0, Number(selectedStaff.monthlyTargetRevenue ?? 0))}
                  rangeStart={earningsRangeStart}
                  rangeEnd={earningsRangeEnd}
                  onRangeStartChange={setEarningsRangeStart}
                  onRangeEndChange={setEarningsRangeEnd}
                  onExportCsv={downloadStaffCsvReport}
                  onExportPdf={printStaffPdfReport}
                  formatCurrency={(value) => currencyFormatter.format(value)}
                  t={t}
                />

                <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
                  {(
                    [
                      ["hours", t("staff.workingHours")],
                      ["breaks", t("staff.breaks")],
                      ["timeoff", t("staff.timeOff")],
                      ["services", t("nav.services")],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id)}
                      className={`rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
                        detailTab === id
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === "hours" && (
                  <StaffWeeklyHoursPanel
                    t={t}
                    workingHours={workingHours}
                    setWorkingHours={setWorkingHours}
                    dayEnabled={dayEnabled}
                    setDayEnabled={setDayEnabled}
                    hasBookableWorkingHours={hasBookableWorkingHours}
                    showDefaultHint={false}
                    saveLabel={t("staff.saveWorkingHours")}
                    savingLabel={t("widget.saving")}
                    onSave={handleSaveWorkingHours}
                    saving={savingHours}
                  />
                )}

                {detailTab === "breaks" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        <Coffee className="h-4 w-4" />
                        {t("staff.breaks")}
                      </h3>
                      <button
                        type="button"
                        onClick={handleSaveScheduleExtras}
                        disabled={savingScheduleExtras}
                        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {savingScheduleExtras ? t("widget.saving") : t("staff.saveBreaksAndTimeOff")}
                      </button>
                    </div>
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {t("staff.breaksWeeklySubtitle")}
                    </p>
                    {breaks.map((b, i) => (
                      <div key={i} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <select
                          value={b.dayOfWeek}
                          onChange={(e) =>
                            setBreaks((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], dayOfWeek: parseInt(e.target.value, 10) };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        >
                          {DAYS.map(({ d, key }) => (
                            <option key={d} value={d}>
                              {t(key)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={b.startTime}
                          onChange={(e) =>
                            setBreaks((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], startTime: e.target.value };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        <input
                          type="time"
                          value={b.endTime}
                          onChange={(e) =>
                            setBreaks((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], endTime: e.target.value };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        <button type="button" onClick={() => removeBreak(i)} className="text-red-600 hover:underline">
                          ×
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addBreak} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
                      {t("staff.addBreak")}
                    </button>

                    <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          {t("staff.breaksByDateSubtitle")}
                        </p>
                        <Link
                          href="/admin/breaks"
                          className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                        >
                          {t("staff.breaksManageFull")}
                        </Link>
                      </div>
                      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{t("staff.exceptionRangeHint")}</p>
                      <div className="mb-3 flex flex-wrap items-end gap-3">
                        <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="mb-1 block">{t("staff.exceptionRangeFrom")}</span>
                          <input
                            type="date"
                            value={staffBreakExceptionRange.start}
                            onChange={(e) =>
                              setStaffBreakExceptionRange((p) => ({ ...p, start: e.target.value }))
                            }
                            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                          />
                        </label>
                        <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="mb-1 block">{t("staff.exceptionRangeTo")}</span>
                          <input
                            type="date"
                            value={staffBreakExceptionRange.end}
                            onChange={(e) =>
                              setStaffBreakExceptionRange((p) => ({ ...p, end: e.target.value }))
                            }
                            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                          />
                        </label>
                      </div>

                      {(staffBreaksWindow?.exceptions ?? []).length === 0 ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("staff.breaksByDateEmpty")}</p>
                      ) : (
                        <>
                          {isAdmin && (
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                {t("breaks.selectedCount").replace("{count}", String(selectedBreakExceptionIds.length))}
                              </span>
                              <button
                                type="button"
                                className="text-violet-600 hover:underline dark:text-violet-400"
                                onClick={() => {
                                  const all = (staffBreaksWindow?.exceptions ?? []).map((x) => x.id);
                                  setSelectedBreakExceptionIds(all);
                                }}
                              >
                                {t("breaks.selectAllInList")}
                              </button>
                              <button
                                type="button"
                                className="text-zinc-600 hover:underline dark:text-zinc-400"
                                onClick={() => setSelectedBreakExceptionIds([])}
                              >
                                {t("breaks.clearSelection")}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  selectedBreakExceptionIds.length === 0 || bulkDeleteBreakExceptionsMutation.isPending
                                }
                                className="text-red-600 hover:underline disabled:opacity-40"
                                onClick={() => {
                                  const n = selectedBreakExceptionIds.length;
                                  if (
                                    n > 0 &&
                                    confirm(t("breaks.confirmBulkDelete").replace("{count}", String(n)))
                                  ) {
                                    bulkDeleteBreakExceptionsMutation.mutate([...selectedBreakExceptionIds]);
                                  }
                                }}
                              >
                                {t("breaks.deleteSelected")}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  (staffBreaksWindow?.exceptions ?? []).length === 0 ||
                                  bulkDeleteBreakExceptionsMutation.isPending
                                }
                                className="text-red-600 hover:underline disabled:opacity-40"
                                onClick={() => {
                                  const all = staffBreaksWindow?.exceptions ?? [];
                                  if (
                                    all.length > 0 &&
                                    confirm(
                                      t("breaks.confirmDeleteAllInList").replace("{count}", String(all.length))
                                    )
                                  ) {
                                    bulkDeleteBreakExceptionsMutation.mutate(all.map((x) => x.id));
                                  }
                                }}
                              >
                                {t("breaks.deleteAllInList")}
                              </button>
                            </div>
                          )}
                          <ul className="space-y-2 text-sm">
                            {(staffBreaksWindow?.exceptions ?? [])
                              .slice()
                              .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                              .map((ex) => {
                                const d = String(ex.date).slice(0, 10);
                                const st = String(ex.startTime).slice(0, 5);
                                const en = String(ex.endTime).slice(0, 5);
                                return (
                                  <li
                                    key={ex.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-600"
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      {isAdmin && (
                                        <input
                                          type="checkbox"
                                          className="rounded border-zinc-300"
                                          checked={selectedBreakExceptionIds.includes(ex.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedBreakExceptionIds((p) =>
                                                p.includes(ex.id) ? p : [...p, ex.id]
                                              );
                                            } else {
                                              setSelectedBreakExceptionIds((p) => p.filter((id) => id !== ex.id));
                                            }
                                          }}
                                        />
                                      )}
                                      <span>
                                        <span className="font-medium">{formatLongWeekdayDateYmd(d, locale)}</span>
                                        <span className="mx-2 text-zinc-400">·</span>
                                        <span className="tabular-nums">
                                          {st}–{en}
                                        </span>
                                      </span>
                                    </span>
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (confirm(t("breaks.confirmDeleteException"))) {
                                            deleteBreakExceptionMutation.mutate(ex.id);
                                          }
                                        }}
                                        className="text-xs text-red-600 hover:underline"
                                      >
                                        {t("services.delete")}
                                      </button>
                                    )}
                                  </li>
                                );
                              })}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {detailTab === "timeoff" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        <CalendarOff className="h-4 w-4" />
                        {t("staff.timeOff")}
                      </h3>
                      <button
                        type="button"
                        onClick={handleSaveScheduleExtras}
                        disabled={savingScheduleExtras}
                        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {savingScheduleExtras ? t("widget.saving") : t("staff.saveBreaksAndTimeOff")}
                      </button>
                    </div>
                    {timeOff.map((to, i) => (
                      <div key={i} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <input
                          type="date"
                          value={to.startDate}
                          onChange={(e) =>
                            setTimeOff((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], startDate: e.target.value };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        <input
                          type="date"
                          value={to.endDate}
                          onChange={(e) =>
                            setTimeOff((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], endDate: e.target.value };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        <select
                          value={to.reason}
                          onChange={(e) =>
                            setTimeOff((p) => {
                              const n = [...p];
                              n[i] = { ...n[i], reason: e.target.value };
                              return n;
                            })
                          }
                          className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800"
                        >
                          <option value="vacation">{t("staff.vacation")}</option>
                          <option value="sick">{t("staff.sick")}</option>
                          <option value="personal">{t("staff.personal")}</option>
                        </select>
                        <button type="button" onClick={() => removeTimeOff(i)} className="text-red-600 hover:underline">
                          ×
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addTimeOff} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
                      {t("staff.addTimeOff")}
                    </button>
                  </div>
                )}

                {detailTab === "services" && (
                  <div className="space-y-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      <Scissors className="h-4 w-4" />
                      {t("staff.myServices")}
                    </h3>
                    {(selectedStaff.staffServices ?? []).length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("staff.noServicesAssigned")}</p>
                    ) : (
                      <div className="space-y-2">
                        {(selectedStaff.staffServices ?? []).map((ss) => (
                          <div
                            key={ss.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800/50"
                          >
                            <div>
                              <p className="font-medium">{ss.service.name}</p>
                              <p className="flex items-center gap-4 text-sm text-zinc-500">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {ss.durationMinutes} min
                                </span>
                                <span className="flex items-center gap-1">₪{Number(ss.price).toFixed(0)}</span>
                              </p>
                            </div>
                            {editingService?.id === ss.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <div>
                                  <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")}</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={480}
                                    value={serviceDuration}
                                    onChange={(e) => setServiceDuration(parseInt(e.target.value, 10) || 30)}
                                    className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                                  />
                                </div>
                                <div>
                                  <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={servicePrice}
                                    onChange={(e) => setServicePrice(parseFloat(e.target.value) || 0)}
                                    className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateStaffServicesMutation.mutate({
                                      staffId: selectedStaff.id,
                                      updates: [
                                        {
                                          staffServiceId: ss.id,
                                          durationMinutes: serviceDuration,
                                          price: servicePrice,
                                        },
                                      ],
                                    });
                                  }}
                                  disabled={updateStaffServicesMutation.isPending}
                                  className="btn-primary rounded px-2 py-1 text-sm"
                                >
                                  {t("staff.save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingService(null)}
                                  className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600"
                                >
                                  {t("staff.cancel")}
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingService(ss);
                                    setServiceDuration(ss.durationMinutes);
                                    setServicePrice(Number(ss.price));
                                  }}
                                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                  aria-label={t("staff.edit")}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(t("staff.confirmRemoveService") || "Remove?")) {
                                      removeStaffServiceMutation.mutate({
                                        staffId: selectedStaff.id,
                                        staffServiceId: ss.id,
                                      });
                                    }
                                  }}
                                  className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                  aria-label={t("staff.delete")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                      <select
                        value={addServiceId}
                        onChange={(e) => setAddServiceId(e.target.value)}
                        className="min-h-[2.75rem] min-w-[10rem] rounded-lg border-2 border-zinc-300 px-3 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                      >
                        <option value="">{t("staff.addService")}</option>
                        {servicesList
                          .filter((s) => !(selectedStaff.staffServices ?? []).some((ss) => ss.service.id === s.id))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                      {addServiceId && (
                        <>
                          <div>
                            <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")} *</span>
                            <input
                              type="number"
                              min={1}
                              max={480}
                              value={serviceDuration}
                              onChange={(e) => setServiceDuration(parseInt(e.target.value, 10) || 30)}
                              className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                            />
                          </div>
                          <div>
                            <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")} *</span>
                            <input
                              type="number"
                              min={0}
                              value={servicePrice}
                              onChange={(e) => setServicePrice(parseFloat(e.target.value) || 0)}
                              className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              addStaffServiceMutation.mutate({
                                staffId: selectedStaff.id,
                                serviceId: addServiceId,
                                durationMinutes: serviceDuration,
                                price: servicePrice,
                              });
                            }}
                            disabled={
                              addStaffServiceMutation.isPending || serviceDuration < 1 || servicePrice <= 0
                            }
                            className="btn-primary rounded-lg px-3 py-1 text-sm disabled:opacity-50"
                          >
                            {t("staff.addService")}
                          </button>
                        </>
                      )}
                      <div className="flex w-full flex-wrap items-end gap-2">
                        {!showNewServiceForm ? (
                          <button
                            type="button"
                            onClick={() => setShowNewServiceForm(true)}
                            className="flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <Plus className="h-4 w-4" />
                            {t("staff.addNewService")}
                          </button>
                        ) : (
                          <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-600 dark:bg-zinc-800/50">
                            <div>
                              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.name")} *</span>
                              <input
                                type="text"
                                value={newServiceName}
                                onChange={(e) => setNewServiceName(e.target.value)}
                                className="w-32 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </div>
                            <div>
                              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")} *</span>
                              <input
                                type="number"
                                min={1}
                                max={480}
                                value={serviceDuration}
                                onChange={(e) => setServiceDuration(parseInt(e.target.value, 10) || 30)}
                                className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </div>
                            <div>
                              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")} *</span>
                              <input
                                type="number"
                                min={0}
                                value={servicePrice}
                                onChange={(e) => setServicePrice(parseFloat(e.target.value) || 0)}
                                className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (!newServiceName.trim()) {
                                  toast.error(t("services.name"));
                                  return;
                                }
                                createAndAssignServiceMutation.mutate({
                                  staffId: selectedStaff.id,
                                  name: newServiceName.trim(),
                                  branchId: selectedStaff.branchId ?? branches[0]?.id ?? "",
                                  durationMinutes: serviceDuration,
                                  price: servicePrice,
                                });
                              }}
                              disabled={
                                createAndAssignServiceMutation.isPending ||
                                !newServiceName.trim() ||
                                !(selectedStaff.branchId ?? branches[0]?.id) ||
                                serviceDuration < 1 ||
                                servicePrice <= 0
                              }
                              className="btn-primary rounded-lg px-3 py-1 text-sm disabled:opacity-50"
                            >
                              {createAndAssignServiceMutation.isPending ? t("widget.loading") : t("staff.addService")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowNewServiceForm(false);
                                setNewServiceName("");
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-600"
                            >
                              {t("staff.cancel")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-white/50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/20">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("staff.selectMemberHint")}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Invite by Phone Modal */}
      {portalReady &&
        modal === "invite" &&
        createPortal(
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">הזמן עובד לפי טלפון</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              הזן מספר טלפון. העובד יתחבר עם המספר וישלים רישום.
            </p>
            <div className="flex gap-2">
              <input
                type="tel"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="050xxxxxxxx"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => inviteByPhoneMutation.mutate(invitePhone)}
                disabled={!invitePhone.trim() || inviteByPhoneMutation.isPending}
                className="btn-primary rounded-lg px-4 py-2 disabled:opacity-50"
              >
                {inviteByPhoneMutation.isPending ? "..." : "שלח"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setModal(null); setInvitePhone(""); }}
              className="mt-4 text-sm text-zinc-500 hover:underline"
            >
              ביטול
            </button>
          </div>
        </div>
      , document.body)}

      {/* Add/Edit Modal */}
      {portalReady &&
        modal &&
        modal !== "invite" &&
        createPortal(
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4 pb-24 lg:pb-4">
          <div className="flex max-h-[calc(100dvh-6rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 lg:max-h-[90vh]">
            <div className="shrink-0 px-6 pt-6">
              <h2 className="mb-4 text-lg font-semibold">
                {modal === "add" ? t("staff.add") : t("staff.edit")}
              </h2>
              {modal === "add" && (
                <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("staff.addModalScheduleHint")}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                {modal === "edit" && editing && (
                  <div className="flex items-center gap-4">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      {editing.avatarUrl ? (
                        <img
                          src={getPhotoUrl(editing.avatarUrl) ?? ""}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-500">
                          {editing.firstName[0]}
                          {editing.lastName[0]}
                        </div>
                      )}
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={handlePhotoChange}
                      />
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100"
                      >
                        <Camera className="h-6 w-6 text-white" />
                      </button>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("staff.uploadPhoto")}</p>
                      <p className="text-xs text-zinc-500">
                        JPEG, PNG, WebP, GIF. Max 5MB.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("staff.name")} (First)
                    </label>
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, firstName: e.target.value }))
                      }
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("staff.name")} (Last)
                    </label>
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, lastName: e.target.value }))
                      }
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.phone")}
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, phone: e.target.value }))
                    }
                    placeholder="050xxxxxxxx"
                    readOnly={modal === "edit"}
                    className={`w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 ${modal === "edit" ? "cursor-not-allowed bg-zinc-100 dark:bg-zinc-800/80" : ""}`}
                  />
                  {modal === "edit" && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("staff.phoneReadOnly")}
                    </p>
                  )}
                </div>

                <BirthDateTripleInput
                  labelKey="register.birthDateOptional"
                  value={form.birthDate}
                  onChange={(iso) => setForm((p) => ({ ...p, birthDate: iso }))}
                />
                <GenderToggle
                  labelKey="customers.gender"
                  value={form.gender}
                  onChange={(v) => setForm((p) => ({ ...p, gender: v === "OTHER" ? "" : v }))}
                />

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.branch")} *
                  </label>
                  <select
                    value={form.branchId}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, branchId: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    required
                  >
                    <option value="">
                      {t("staff.selectBranch")}
                    </option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {branchDisplayName(b.name, t)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                  <label className="mb-1 block text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t("staff.monthlyTarget")} ★
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={form.monthlyTargetRevenue}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, monthlyTargetRevenue: e.target.value }))
                    }
                    placeholder="0"
                    className="w-full rounded-lg border border-amber-300 bg-white px-4 py-2 dark:border-amber-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    {t("staff.monthlyTargetDesc")}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.bio")}
                  </label>
                  <textarea
                    value={form.bio}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, bio: e.target.value }))
                    }
                    rows={2}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.instagram")}
                  </label>
                  <input
                    type="text"
                    value={form.instagram}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, instagram: e.target.value }))
                    }
                    placeholder="@username"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.facebook")}
                  </label>
                  <input
                    type="text"
                    value={form.facebook}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, facebook: e.target.value }))
                    }
                    placeholder="Profile URL"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("staff.whatsapp")}
                  </label>
                  <input
                    type="text"
                    value={form.whatsapp}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, whatsapp: e.target.value }))
                    }
                    placeholder="+972501234567"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
              </form>
            </div>

            <div className="shrink-0 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const wasAdd = modal === "add";
                  setModal(null);
                  setEditing(null);
                  if (wasAdd) resetForm();
                }}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("staff.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!form.firstName.trim() || !form.lastName.trim()) {
                    toast.error(t("staff.name") + " *");
                    return;
                  }
                  if (modal === "add") {
                    createMutation.mutate(form);
                  } else if (editing) {
                    updateMutation.mutate({ id: editing.id, data: form, omitPhone: true });
                  }
                }}
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  photoUploadMutation.isPending
                }
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? t("widget.loading")
                  : t("staff.save")}
              </button>
            </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
