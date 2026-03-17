"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, apiUpload } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { useBranchStore } from "@/stores/branch-store";
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

const DAYS = [
  { d: 0, key: "staff.days.sun" },
  { d: 1, key: "staff.days.mon" },
  { d: 2, key: "staff.days.tue" },
  { d: 3, key: "staff.days.wed" },
  { d: 4, key: "staff.days.thu" },
  { d: 5, key: "staff.days.fri" },
  { d: 6, key: "staff.days.sat" },
];

export interface StaffServiceItem {
  id: string;
  durationMinutes: number;
  price: number;
  service: { id: string; name: string };
}

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
  branch?: { id: string; name: string } | null;
  staffServices?: StaffServiceItem[];
  staffWorkingHours?: { dayOfWeek: number; startTime: string; endTime: string }[];
  staffBreaks?: { id?: string; dayOfWeek: number; startTime: string; endTime: string }[];
  staffTimeOff?: { id?: string; startDate: string; endDate: string; reason: string | null }[];
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
}

function branchDisplayName(name: string | null | undefined, t: (k: string) => string): string {
  if (!name) return "—";
  return name === "Main Branch" ? t("branches.mainBranch") : name;
}

export default function AdminStaffPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"add" | "edit" | "invite" | null>(null);
  const [invitePhone, setInvitePhone] = useState("");
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [activeTab, setActiveTab] = useState<"profile" | "schedule" | "services">("profile");
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

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: String(showInactive),
    excludeManagers: "true",
  });
  if (selectedBranchId) queryParams.set("branchId", selectedBranchId);

  const { data: staffListRaw = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ["staff", businessId, showInactive, selectedBranchId],
    queryFn: () =>
      apiClient<StaffMember[]>(`/staff?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  const staffList = searchQuery.trim()
    ? staffListRaw.filter(
        (s) =>
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.phone?.includes(searchQuery.replace(/\D/g, ""))
      )
    : staffListRaw;

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
  if (editing?.branchId) servicesParams.set("branchId", editing.branchId);
  const { data: servicesList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["services", businessId, editing?.branchId],
    queryFn: () =>
      apiClient<{ id: string; name: string }[]>(`/services?${servicesParams.toString()}`),
    enabled: !!businessId && !!editing && modal === "edit",
  });

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
        }),
      }),
    onSuccess: async (staff) => {
      await saveSchedule(staff.id);
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      resetForm();
      toast.success("Staff member added");
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
        }),
      }),
    onSuccess: async (staff) => {
      await saveSchedule(staff.id);
      queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
      setModal(null);
      setEditing(null);
      resetForm();
      toast.success("Staff updated");
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
      setEditing(data);
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
      setEditing(data);
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
      setEditing(data);
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
      setEditing(data);
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

  async function saveSchedule(staffId: string) {
    for (const [dayStr, { start, end }] of Object.entries(workingHours)) {
      if (start && end) {
        await apiClient("/staff/working-hours", {
          method: "POST",
          body: JSON.stringify({
            staffId,
            businessId,
            dayOfWeek: parseInt(dayStr, 10),
            startTime: start,
            endTime: end,
          }),
        });
      }
    }
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
    });
    setWorkingHours({});
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
    });
    setWorkingHours({});
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
    });
    const wh: Record<number, { start: string; end: string }> = {};
    for (const h of staff.staffWorkingHours || []) {
      wh[h.dayOfWeek] = { start: h.startTime, end: h.endTime };
    }
    setWorkingHours(wh);
    setBreaks(
      (staff.staffBreaks || []).map((b) => ({
        id: (b as { id?: string }).id,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
      }))
    );
    setTimeOff(
      (staff.staffTimeOff || []).map((t) => ({
        id: (t as { id?: string }).id,
        startDate: t.startDate.split("T")[0],
        endDate: t.endDate.split("T")[0],
        reason: t.reason ?? "",
      }))
    );
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
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.staff")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {t("staff.subtitle")}
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
          <div className="flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`rounded px-2 py-1 text-sm ${viewMode === "cards" ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`rounded px-2 py-1 text-sm ${viewMode === "table" ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
              Table
            </button>
          </div>
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
      ) : viewMode === "table" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-4 py-3 text-left font-medium">
                  <div className="flex items-center gap-3">
                    <span className="inline-block h-8 w-8 shrink-0" aria-hidden />
                    {t("staff.name")}
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-medium">{t("staff.branch")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("staff.status")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((staff) => (
                <tr key={staff.id} className="border-b border-zinc-100 dark:border-zinc-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StaffAvatar
                        avatarUrl={staff.avatarUrl}
                        firstName={staff.firstName}
                        lastName={staff.lastName}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="font-medium">
                        {staff.firstName} {staff.lastName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{branchDisplayName(staff.branch?.name, t)}</td>
                  <td className="px-4 py-3 text-center">
                    {isAdmin ? (
                      <input
                        type="checkbox"
                        checked={staff.isActive}
                        onChange={() => {
                          if (staff.isActive) {
                            if (confirm(t("staff.confirmDeactivate"))) deactivateMutation.mutate(staff.id);
                          } else {
                            activateMutation.mutate(staff.id);
                          }
                        }}
                        className="shrink-0"
                        aria-label={staff.isActive ? t("staff.deactivate") : t("staff.activate")}
                      />
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          staff.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                        }`}
                      >
                        {staff.isActive ? "Active" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(staff)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                          aria-label={t("staff.edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t("staff.confirmDelete"))) deleteMutation.mutate(staff.id);
                          }}
                          className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label={t("staff.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staffList.map((staff) => (
            <div
              key={staff.id}
              className={`rounded-xl border bg-white p-4 dark:bg-zinc-800 ${
                staff.isActive
                  ? "border-zinc-200 dark:border-zinc-700"
                  : "border-zinc-200 opacity-75 dark:border-zinc-700"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  {staff.avatarUrl ? (
                    <img
                      src={getPhotoUrl(staff.avatarUrl) ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-zinc-500">
                      {staff.firstName[0]}
                      {staff.lastName[0]}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">
                        {staff.firstName} {staff.lastName}
                      </h3>
                      {staff.title && (
                        <p className="text-sm text-zinc-500">{staff.title}</p>
                      )}
                      {staff.branch && (
                        <p className="text-xs text-zinc-500">{branchDisplayName(staff.branch.name, t)}</p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(staff)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                          aria-label={t("staff.edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {staff.isActive ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(t("staff.confirmDeactivate"))) {
                                deactivateMutation.mutate(staff.id);
                              }
                            }}
                            className="rounded p-1.5 text-zinc-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
                            aria-label={t("staff.deactivate")}
                            title={t("staff.deactivate")}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => activateMutation.mutate(staff.id)}
                            className="rounded p-1.5 text-zinc-500 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20 dark:hover:text-green-400"
                            aria-label={t("staff.activate")}
                          >
                            <UserPlus className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t("staff.confirmDelete"))) {
                              deleteMutation.mutate(staff.id);
                            }
                          }}
                          className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label={t("staff.delete")}
                          title={t("staff.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite by Phone Modal */}
      {modal === "invite" && (
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
      )}

      {/* Add/Edit Modal */}
      {modal && modal !== "invite" && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4 pb-24 lg:pb-4">
          <div className="flex max-h-[calc(100dvh-6rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 lg:max-h-[90vh]">
            <div className="shrink-0 px-6 pt-6">
              <h2 className="mb-4 text-lg font-semibold">
                {modal === "add" ? t("staff.add") : t("staff.edit")}
              </h2>
              <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`border-b-2 px-2 py-1 text-sm ${
                  activeTab === "profile"
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-transparent"
                }`}
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("schedule")}
                className={`border-b-2 px-2 py-1 text-sm ${
                  activeTab === "schedule"
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-transparent"
                }`}
              >
                {t("staff.settings")}
              </button>
              {modal === "edit" && (
                <button
                  type="button"
                  onClick={() => setActiveTab("services")}
                  className={`border-b-2 px-2 py-1 text-sm ${
                    activeTab === "services"
                      ? "border-zinc-900 dark:border-zinc-100"
                      : "border-transparent"
                  }`}
                >
                  {t("nav.services")}
                </button>
              )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {activeTab === "profile" && (
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
            )}

            {activeTab === "schedule" && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4" />
                    {t("staff.workingHours")}
                  </h3>
                  <div className="space-y-2">
                    {DAYS.map(({ d, key }) => (
                      <div
                        key={d}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="w-10">{t(key)}</span>
                        <input
                          type="time"
                          value={workingHours[d]?.start ?? ""}
                          onChange={(e) =>
                            setWorkingHours((p) => ({
                              ...p,
                              [d]: {
                                start: e.target.value,
                                end: p[d]?.end ?? "",
                              },
                            }))
                          }
                          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        <span>–</span>
                        <input
                          type="time"
                          value={workingHours[d]?.end ?? ""}
                          onChange={(e) =>
                            setWorkingHours((p) => ({
                              ...p,
                              [d]: {
                                start: p[d]?.start ?? "",
                                end: e.target.value,
                              },
                            }))
                          }
                          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Coffee className="h-4 w-4" />
                    {t("staff.breaks")}
                  </h3>
                  {breaks.map((b, i) => (
                    <div
                      key={i}
                      className="mb-2 flex items-center gap-2 text-sm"
                    >
                      <select
                        value={b.dayOfWeek}
                        onChange={(e) =>
                          setBreaks((p) => {
                            const n = [...p];
                            n[i] = { ...n[i], dayOfWeek: parseInt(e.target.value, 10) };
                            return n;
                          })
                        }
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
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
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
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
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      <button
                        type="button"
                        onClick={() => removeBreak(i)}
                        className="text-red-600 hover:underline"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addBreak}
                    className="text-sm text-zinc-600 underline dark:text-zinc-400"
                  >
                    {t("staff.addBreak")}
                  </button>
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <CalendarOff className="h-4 w-4" />
                    {t("staff.timeOff")}
                  </h3>
                  {timeOff.map((to, i) => (
                    <div
                      key={i}
                      className="mb-2 flex flex-wrap items-center gap-2 text-sm"
                    >
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
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
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
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
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
                        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                      >
                        <option value="vacation">{t("staff.vacation")}</option>
                        <option value="sick">{t("staff.sick")}</option>
                        <option value="personal">{t("staff.personal")}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeTimeOff(i)}
                        className="text-red-600 hover:underline"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addTimeOff}
                    className="text-sm text-zinc-600 underline dark:text-zinc-400"
                  >
                    {t("staff.addTimeOff")}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "services" && editing && (
              <div className="space-y-4">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Scissors className="h-4 w-4" />
                  {t("staff.myServices")}
                </h3>
                {(editing.staffServices ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("staff.noServicesAssigned")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(editing.staffServices ?? []).map((ss) => (
                      <div
                        key={ss.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-600 dark:bg-zinc-800/50"
                      >
                        <div>
                          <p className="font-medium">{ss.service.name}</p>
                          <p className="flex items-center gap-4 text-sm text-zinc-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {ss.durationMinutes} min
                            </span>
                            <span className="flex items-center gap-1">
                              ₪{Number(ss.price).toFixed(0)}
                            </span>
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
                                onChange={(e) =>
                                  setServiceDuration(parseInt(e.target.value, 10) || 30)
                                }
                                className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </div>
                            <div>
                              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
                              <input
                                type="number"
                                min={0}
                                value={servicePrice}
                                onChange={(e) =>
                                  setServicePrice(parseFloat(e.target.value) || 0)
                                }
                                className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateStaffServicesMutation.mutate({
                                  staffId: editing.id,
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
                              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                              aria-label={t("staff.edit")}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(t("staff.confirmRemoveService") || "Remove this service?")) {
                                  removeStaffServiceMutation.mutate({
                                    staffId: editing.id,
                                    staffServiceId: ss.id,
                                  });
                                }
                              }}
                              className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
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
                    className="min-h-[2.75rem] min-w-[10rem] rounded-lg border-2 border-zinc-300 px-3 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">{t("staff.addService")}</option>
                    {servicesList
                      .filter(
                        (s) =>
                          !(editing.staffServices ?? []).some(
                            (ss) => ss.service.id === s.id
                          )
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  {addServiceId && (
                    <>
                      <div>
                        <span className="mb-0.5 block text-xs text-zinc-500">
                          {t("services.duration")} <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={480}
                          placeholder={t("services.duration")}
                          value={serviceDuration}
                          onChange={(e) =>
                            setServiceDuration(parseInt(e.target.value, 10) || 30)
                          }
                          className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      </div>
                      <div>
                        <span className="mb-0.5 block text-xs text-zinc-500">
                          {t("services.price")} <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          placeholder={t("services.price")}
                          value={servicePrice}
                          onChange={(e) =>
                            setServicePrice(parseFloat(e.target.value) || 0)
                          }
                          className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          addStaffServiceMutation.mutate({
                            staffId: editing.id,
                            serviceId: addServiceId,
                            durationMinutes: serviceDuration,
                            price: servicePrice,
                          });
                        }}
                        disabled={
                          addStaffServiceMutation.isPending ||
                          serviceDuration < 1 ||
                          servicePrice <= 0
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
                          <span className="mb-0.5 block text-xs text-zinc-500">
                            {t("services.name")} <span className="text-red-500">*</span>
                          </span>
                          <input
                            type="text"
                            value={newServiceName}
                            onChange={(e) => setNewServiceName(e.target.value)}
                            placeholder={t("services.name")}
                            className="w-32 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                          />
                        </div>
                        <div>
                          <span className="mb-0.5 block text-xs text-zinc-500">
                            {t("services.duration")} <span className="text-red-500">*</span>
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={480}
                            value={serviceDuration}
                            onChange={(e) =>
                              setServiceDuration(parseInt(e.target.value, 10) || 30)
                            }
                            className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                          />
                        </div>
                        <div>
                          <span className="mb-0.5 block text-xs text-zinc-500">
                            {t("services.price")} <span className="text-red-500">*</span>
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={servicePrice}
                            onChange={(e) =>
                              setServicePrice(parseFloat(e.target.value) || 0)
                            }
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
                              staffId: editing.id,
                              name: newServiceName.trim(),
                              branchId: editing.branchId ?? branches[0]?.id ?? "",
                              durationMinutes: serviceDuration,
                              price: servicePrice,
                            });
                          }}
                          disabled={
                            createAndAssignServiceMutation.isPending ||
                            !newServiceName.trim() ||
                            !(editing.branchId ?? branches[0]?.id) ||
                            serviceDuration < 1 ||
                            servicePrice <= 0
                          }
                          className="btn-primary rounded-lg px-3 py-1 text-sm disabled:opacity-50"
                        >
                          {createAndAssignServiceMutation.isPending
                            ? t("widget.loading")
                            : t("staff.addService")}
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
            </div>

            <div className="shrink-0 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  setEditing(null);
                  resetForm();
                }}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("staff.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!form.firstName.trim() || !form.lastName.trim()) {
                    setActiveTab("profile");
                    return;
                  }
                  if (activeTab === "profile") {
                    if (modal === "add") {
                      createMutation.mutate(form);
                    } else if (editing) {
                      updateMutation.mutate({ id: editing.id, data: form, omitPhone: true });
                    }
                  } else {
                    if (modal === "add") {
                      createMutation.mutate(form);
                    } else if (editing) {
                      updateMutation.mutate({ id: editing.id, data: form, omitPhone: true });
                    }
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
      )}
    </div>
  );
}
