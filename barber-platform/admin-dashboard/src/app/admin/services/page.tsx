"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { useLocaleStore } from "@/stores/locale-store";
import { translateApiError } from "@/lib/i18n";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBranchStore } from "@/stores/branch-store";
import { Plus, Pencil, Trash2, GripVertical, Users, Copy } from "lucide-react";

export interface ServiceItem {
  id: string;
  businessId: string;
  branchId?: string | null;
  name: string;
  slug: string;
  durationMinutes: number;
  price: number;
  color: string | null;
  isActive: boolean;
  sortOrder: number;
  staffServices?: {
    staff: { id: string; firstName: string; lastName: string };
    durationMinutes?: number;
    price?: number;
  }[];
  branch?: { id: string; name: string } | null;
}

interface ServiceForm {
  name: string;
  durationMinutes: number;
  price: number;
  color: string;
  isActive: boolean;
  branchId: string;
}

const DEFAULT_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
];

function SortableServiceCard({
  service,
  isAdmin,
  onEdit,
  onDelete,
  onAssignStaff,
  onDuplicate,
  t,
}: {
  service: ServiceItem;
  isAdmin: boolean;
  onEdit: (s: ServiceItem) => void;
  onDelete: (s: ServiceItem) => void;
  onAssignStaff: (s: ServiceItem) => void;
  onDuplicate: (s: ServiceItem) => void;
  t: (key: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const staffCount = service.staffServices?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-xl border bg-white p-4 dark:bg-zinc-800 ${
        isDragging
          ? "z-50 opacity-90 shadow-lg"
          : "border-zinc-200 dark:border-zinc-700"
      } ${!service.isActive ? "opacity-60" : ""}`}
    >
      {isAdmin && (
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:bg-zinc-700"
          {...attributes}
          {...listeners}
          aria-label={t("services.dragToReorder")}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      )}
      <div
        className="h-10 w-10 shrink-0 rounded-lg"
        style={{
          backgroundColor: service.color || "#94a3b8",
        }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{service.name}</h3>
        <p className="text-sm text-zinc-500">
          {t("services.perEmployee")}
          {staffCount > 0 && (
            <span className="ml-2 flex items-center gap-1">
              <Users className="inline h-3.5 w-3.5" />
              {staffCount} staff
            </span>
          )}
        </p>
      </div>
      {isAdmin && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onDuplicate(service)}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label={t("services.duplicate")}
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onAssignStaff(service)}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label={t("services.assignStaff")}
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(service)}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label={t("services.edit")}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(service)}
            className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            aria-label={t("services.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminServicesPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [assignStaffFor, setAssignStaffFor] = useState<ServiceItem | null>(null);
  const [assignDuration, setAssignDuration] = useState(30);
  const [assignPrice, setAssignPrice] = useState(0);
  const [duplicateFor, setDuplicateFor] = useState<ServiceItem | null>(null);
  const [duplicateTargetBranchId, setDuplicateTargetBranchId] = useState("");

  const [form, setForm] = useState<ServiceForm>({
    name: "",
    durationMinutes: 30,
    price: 0,
    color: "#3B82F6",
    isActive: true,
    branchId: "",
  });

  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

  const staffForAddQuery = useQuery<
    { id: string; firstName: string; lastName: string }[]
  >({
    queryKey: ["staff", businessId, form.branchId],
    queryFn: () => {
      const p = new URLSearchParams({ businessId: businessId || "", includeInactive: "true" });
      if (form.branchId) p.set("branchId", form.branchId);
      return apiClient<{ id: string; firstName: string; lastName: string }[]>(
        `/staff?${p.toString()}`
      );
    },
    enabled: !!businessId && modal === "add",
  });
  const staffForAdd = staffForAddQuery.data ?? [];

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: String(showInactive),
  });
  if (selectedBranchId) queryParams.set("branchId", selectedBranchId);

  const { data: services = [], isLoading } = useQuery<ServiceItem[]>({
    queryKey: ["services", businessId, showInactive, selectedBranchId],
    queryFn: () =>
      apiClient<ServiceItem[]>(`/services?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  const staffQueryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: "true",
  });
  if (assignStaffFor?.branchId) staffQueryParams.set("branchId", assignStaffFor.branchId);

  const { data: staffList = [] } = useQuery<
    { id: string; firstName: string; lastName: string }[]
  >({
    queryKey: ["staff", businessId, assignStaffFor?.branchId],
    queryFn: () =>
      apiClient<{ id: string; firstName: string; lastName: string }[]>(
        `/staff?${staffQueryParams.toString()}`
      ),
    enabled: !!businessId,
  });

  const createMutation = useMutation({
    mutationFn: (data: ServiceForm & { staffAssignments?: { staffId: string; durationMinutes: number; price: number }[] }) =>
      apiClient<ServiceItem>("/services", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          branchId: data.branchId || (branches.length === 1 ? branches[0].id : undefined),
          name: data.name,
          color: data.color || undefined,
          isActive: data.isActive,
          staffAssignments: data.staffAssignments,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setModal(null);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceForm }) =>
      apiClient<ServiceItem>(`/services/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          name: data.name,
          color: data.color || undefined,
          isActive: data.isActive,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setModal(null);
      setEditing(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<{ success: boolean }>(`/services/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setModal(null);
      setEditing(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (serviceIds: string[]) =>
      apiClient<ServiceItem[]>("/services/reorder", {
        method: "POST",
        body: JSON.stringify({ businessId, serviceIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    },
  });

  const assignStaffMutation = useMutation({
    mutationFn: ({
      serviceId,
      staffAssignments,
    }: {
      serviceId: string;
      staffAssignments: { staffId: string; durationMinutes: number; price: number }[];
    }) =>
      apiClient<ServiceItem>(`/services/${serviceId}/staff`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, staffAssignments }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setAssignStaffFor(null);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ serviceId, targetBranchId }: { serviceId: string; targetBranchId: string }) =>
      apiClient<ServiceItem>(`/services/${serviceId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ businessId, targetBranchId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setDuplicateFor(null);
      setDuplicateTargetBranchId("");
    },
  });

  const resetForm = () =>
    setForm({
      name: "",
      durationMinutes: 30,
      price: 0,
      color: "#3B82F6",
      isActive: true,
      branchId: selectedBranchId || (branches.length === 1 ? branches[0].id : "") || "",
    });

  const openAdd = () => {
    resetForm();
    setEditing(null);
    setSelectedStaffIds([]);
    setModal("add");
  };

  const openEdit = (service: ServiceItem) => {
    setForm({
      name: service.name,
      durationMinutes: service.durationMinutes,
      price: Number(service.price),
      color: service.color || "#3B82F6",
      isActive: service.isActive,
      branchId: service.branchId ?? selectedBranchId ?? "",
    });
    setEditing(service);
    setModal("edit");
  };

  const openAssignStaff = (service: ServiceItem) => {
    setAssignStaffFor(service);
    const staffIds = service.staffServices?.map((ss) => ss.staff.id) ?? [];
    setSelectedStaffIds(staffIds);
    const first = service.staffServices?.[0];
    setAssignDuration(first?.durationMinutes ?? 30);
    setAssignPrice(first ? Number(first.price ?? 0) : 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal === "add") {
      const staffAssignments =
        selectedStaffIds.length > 0
          ? selectedStaffIds.map((staffId) => ({
              staffId,
              durationMinutes: Math.max(1, form.durationMinutes),
              price: Math.max(0, form.price),
            }))
          : undefined;
      createMutation.mutate({ ...form, staffAssignments });
    } else if (modal === "edit" && editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    }
  };

  const handleDelete = (service: ServiceItem) => {
    if (confirm(t("services.confirmDelete"))) {
      deleteMutation.mutate(service.id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = services.findIndex((s) => s.id === active.id);
    const newIndex = services.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(services, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map((s) => s.id));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view services.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("widget.loading")}</p>
      </div>
    );
  }

  const err =
    createMutation.error ??
    updateMutation.error ??
    deleteMutation.error ??
    reorderMutation.error ??
    assignStaffMutation.error;
  const rawErrMsg = err instanceof Error ? err.message : err ? String(err) : "";
  const errMsg = rawErrMsg ? translateApiError(locale, rawErrMsg) : "";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.services")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {t("services.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("services.showInactive")}
          </label>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              {t("services.add")}
            </button>
          )}
        </div>
      </div>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {errMsg}
        </div>
      )}

      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">
            {t("services.empty")}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              {t("services.addFirst")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={services.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {services.map((service) => (
                <SortableServiceCard
                  key={service.id}
                  service={service}
                  isAdmin={!!isAdmin}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onAssignStaff={openAssignStaff}
                  onDuplicate={(s) => setDuplicateFor(s)}
                  t={t}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">
              {modal === "add" ? t("services.add") : t("services.edit")}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {modal === "add" && branches.length > 1 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("branches.name")}
                  </label>
                  <select
                    value={form.branchId}
                    onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    required={modal === "add"}
                  >
                    <option value="">{t("branches.allBranches")}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {modal === "add" && branches.length === 1 && (
                <input type="hidden" value={form.branchId || branches[0]?.id} readOnly />
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.name")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  required
                />
              </div>
              {modal === "add" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("services.duration")}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={form.durationMinutes}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          durationMinutes: parseInt(e.target.value, 10) || 0,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("services.price")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.price}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          price: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </div>
                </div>
              )}
              {modal === "add" && staffForAdd.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("services.assignStaff")}
                  </label>
                  <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("services.assignStaffOnAdd") ?? "בחר עובדים להקצאה עם המחיר והזמן למעלה"}
                  </p>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                    {staffForAdd.map((staff) => (
                      <label
                        key={staff.id}
                        className="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStaffIds.includes(staff.id)}
                          onChange={(e) => {
                            setSelectedStaffIds((p) =>
                              e.target.checked
                                ? [...p, staff.id]
                                : p.filter((id) => id !== staff.id)
                            );
                          }}
                        />
                        <span className="text-sm">
                          {staff.firstName} {staff.lastName}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {modal === "edit" && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("services.priceDurationPerEmployee") ?? "משך ומחיר נקבעים לכל עובד בהקצאה"}
                </p>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.color")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, color: c }))}
                      className={`h-8 w-8 rounded-full border-2 ${
                        form.color === c
                          ? "border-zinc-900 dark:border-zinc-100"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Select ${c}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, color: e.target.value }))
                    }
                    className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, isActive: e.target.checked }))
                  }
                />
                {t("services.isActive")}
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModal(null);
                    setEditing(null);
                    resetForm();
                  }}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
                >
                  {t("services.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t("widget.loading")
                    : t("services.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate to Branch Modal */}
      {duplicateFor && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">
              {t("services.duplicate")} – {duplicateFor.name}
            </h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              {t("services.duplicateDesc")}
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">
                {t("branches.name")}
              </label>
              <select
                value={duplicateTargetBranchId}
                onChange={(e) => setDuplicateTargetBranchId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">{t("services.selectBranch")}</option>
                {branches
                  .filter((b) => b.id !== duplicateFor.branchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDuplicateFor(null);
                  setDuplicateTargetBranchId("");
                }}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  duplicateTargetBranchId &&
                  duplicateMutation.mutate({
                    serviceId: duplicateFor.id,
                    targetBranchId: duplicateTargetBranchId,
                  })
                }
                disabled={!duplicateTargetBranchId || duplicateMutation.isPending}
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {duplicateMutation.isPending
                  ? t("widget.loading")
                  : t("services.duplicate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Staff Modal */}
      {assignStaffFor && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">
              {t("services.assignStaff")} – {assignStaffFor.name}
            </h2>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.duration")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={assignDuration}
                  onChange={(e) =>
                    setAssignDuration(parseInt(e.target.value, 10) || 30)
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.price")}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={assignPrice}
                  onChange={(e) =>
                    setAssignPrice(parseFloat(e.target.value) || 0)
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {staffList.map((staff) => (
                <label
                  key={staff.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedStaffIds.includes(staff.id)}
                    onChange={(e) => {
                      setSelectedStaffIds((p) =>
                        e.target.checked
                          ? [...p, staff.id]
                          : p.filter((id) => id !== staff.id)
                      );
                    }}
                  />
                  <span>
                    {staff.firstName} {staff.lastName}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAssignStaffFor(null)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  assignStaffMutation.mutate({
                    serviceId: assignStaffFor.id,
                    staffAssignments: selectedStaffIds.map((staffId) => ({
                      staffId,
                      durationMinutes: Math.max(1, assignDuration),
                      price: Math.max(0, assignPrice),
                    })),
                  })
                }
                disabled={assignStaffMutation.isPending}
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {assignStaffMutation.isPending
                  ? t("widget.loading")
                  : t("services.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
