"use client";

import { useState, useEffect, useMemo } from "react";
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
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { StaffSelector } from "@/components/appointments/staff-selector";
import { Plus, Pencil, Trash2, GripVertical, Copy, UserX } from "lucide-react";
import toast from "react-hot-toast";

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
  blockAllStaff?: boolean;
  blockedStaffIds?: string[];
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

interface StaffBoardRow {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  businessRoleSlug?: string | null;
  staffServices: Array<{
    id: string;
    durationMinutes: number;
    price: number | string;
    allowBooking: boolean;
    service: { id: string; name: string; isActive?: boolean };
  }>;
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
  onManageBlocks,
  onDuplicate,
  t,
}: {
  service: ServiceItem;
  isAdmin: boolean;
  onEdit: (s: ServiceItem) => void;
  onDelete: (s: ServiceItem) => void;
  onManageBlocks: (s: ServiceItem) => void;
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

  const blockedCount = service.blockedStaffIds?.length ?? 0;
  const showBlockLine = service.blockAllStaff || blockedCount > 0;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        transition: isDragging ? undefined : style.transition,
      }}
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
        {showBlockLine && (
          <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-400">
            {service.blockAllStaff
              ? t("services.blockedForEveryone")
              : blockedCount === 1
                ? t("services.blockedForOneStaffMember")
                : t("services.blockedForNStaffMembers").replace("{n}", String(blockedCount))}
          </p>
        )}
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
            onClick={() => onManageBlocks(service)}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label={t("services.manageBlocks")}
          >
            <UserX className="h-4 w-4" />
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
  const myStaffId = useAuthStore((s) => s.user?.staffId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const selectedBranchId = useEffectiveBranchId(businessId);
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [blocksFor, setBlocksFor] = useState<ServiceItem | null>(null);
  const [blockAllStaff, setBlockAllStaff] = useState(false);
  const [blockedStaffIds, setBlockedStaffIds] = useState<string[]>([]);
  const [duplicateFor, setDuplicateFor] = useState<ServiceItem | null>(null);
  const [duplicateTargetBranchId, setDuplicateTargetBranchId] = useState("");
  const [boardSelectedStaffId, setBoardSelectedStaffId] = useState("");
  const [boardAddOpen, setBoardAddOpen] = useState(false);
  const [boardAddCatalogId, setBoardAddCatalogId] = useState("");
  const [boardAddDuration, setBoardAddDuration] = useState(30);
  const [boardAddPrice, setBoardAddPrice] = useState(0);
  const [boardEditRow, setBoardEditRow] = useState<{
    staffServiceId: string;
    name: string;
    durationMinutes: number;
    price: number;
  } | null>(null);

  const [form, setForm] = useState<ServiceForm>({
    name: "",
    durationMinutes: 30,
    price: 0,
    color: "#3B82F6",
    isActive: true,
    branchId: "",
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: "false",
  });
  if (selectedBranchId) queryParams.set("branchId", selectedBranchId);

  const { data: services = [], isLoading } = useQuery<ServiceItem[]>({
    queryKey: ["services", businessId, selectedBranchId],
    queryFn: () =>
      apiClient<ServiceItem[]>(`/services?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  /** Local id order so reorder feels instant; merged with latest `services` from the server. */
  const [catalogOrderIds, setCatalogOrderIds] = useState<string[]>([]);

  useEffect(() => {
    setCatalogOrderIds(services.map((s) => s.id));
  }, [services]);

  const catalogListOrdered = useMemo(() => {
    const byId = new Map(services.map((s) => [s.id, s]));
    const validOrder =
      catalogOrderIds.length === services.length &&
      services.length > 0 &&
      catalogOrderIds.every((id) => byId.has(id));
    if (!validOrder) {
      return services;
    }
    return catalogOrderIds.map((id) => byId.get(id)!) as ServiceItem[];
  }, [services, catalogOrderIds]);

  const boardStaffParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: "true",
  });
  if (selectedBranchId) boardStaffParams.set("branchId", selectedBranchId);

  const { data: boardStaffList = [], isLoading: boardStaffLoading } = useQuery<
    StaffBoardRow[]
  >({
    queryKey: ["staff", businessId, "serviceBoard", selectedBranchId],
    queryFn: () =>
      apiClient<StaffBoardRow[]>(`/staff?${boardStaffParams.toString()}`),
    enabled: !!businessId,
  });

  const selectedBoardStaff = boardStaffList.find((s) => s.id === boardSelectedStaffId);
  const canEditBoardSelection =
    !!isAdmin || (!!myStaffId && boardSelectedStaffId === myStaffId);
  const catalogForBoardAdd =
    selectedBoardStaff == null
      ? []
      : services.filter((s) => {
          const assigned = new Set(
            selectedBoardStaff.staffServices.map((ss) => ss.service.id)
          );
          if (!s.isActive || assigned.has(s.id)) return false;
          if (s.blockAllStaff) return false;
          if ((s.blockedStaffIds ?? []).includes(selectedBoardStaff.id)) return false;
          return true;
        });

  useEffect(() => {
    if (boardStaffList.length === 0) {
      setBoardSelectedStaffId("");
      return;
    }
    setBoardSelectedStaffId((prev) =>
      prev && boardStaffList.some((s) => s.id === prev) ? prev : boardStaffList[0].id
    );
  }, [boardStaffList]);

  const staffQueryParams = new URLSearchParams({
    businessId: businessId || "",
    includeInactive: "true",
  });
  if (blocksFor?.branchId) staffQueryParams.set("branchId", blocksFor.branchId);

  const { data: staffList = [] } = useQuery<
    { id: string; firstName: string; lastName: string }[]
  >({
    queryKey: ["staff", businessId, "blocks", blocksFor?.branchId],
    queryFn: () =>
      apiClient<{ id: string; firstName: string; lastName: string }[]>(
        `/staff?${staffQueryParams.toString()}`
      ),
    enabled: !!businessId && !!blocksFor,
  });

  const createMutation = useMutation({
    mutationFn: (data: ServiceForm) => {
      const branchIds = new Set(branches.map((b) => b.id));
      const fromForm =
        data.branchId && branchIds.has(data.branchId) ? data.branchId : "";
      const branchId =
        fromForm || (branches.length === 1 ? branches[0].id : undefined);
      return apiClient<ServiceItem>("/services", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          branchId,
          name: data.name,
          color: data.color || undefined,
          isActive: data.isActive,
        }),
      });
    },
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
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    },
  });

  const blocksMutation = useMutation({
    mutationFn: ({
      serviceId,
      payload,
    }: {
      serviceId: string;
      payload: { blockAllStaff: boolean; blockedStaffIds: string[] };
    }) =>
      apiClient<ServiceItem>(`/services/${serviceId}/blocks`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, ...payload }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setBlocksFor(null);
    },
  });

  const boardPatchMutation = useMutation({
    mutationFn: async ({
      targetStaffId,
      updates,
    }: {
      targetStaffId: string;
      updates: Array<{
        staffServiceId: string;
        allowBooking?: boolean;
        durationMinutes?: number;
        price?: number;
      }>;
    }) => {
      if (isAdmin) {
        return apiClient(`/staff/${targetStaffId}/services`, {
          method: "PATCH",
          body: JSON.stringify({ businessId, updates }),
        });
      }
      if (targetStaffId !== myStaffId) {
        throw new Error("Forbidden");
      }
      return apiClient("/staff/me/services", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId, "serviceBoard"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      toast.success(t("widget.saved"));
      setBoardEditRow(null);
    },
    onError: (e: Error) => toast.error(translateApiError(locale, e.message)),
  });

  const boardAddMutation = useMutation({
    mutationFn: async ({
      targetStaffId,
      serviceId,
      durationMinutes,
      price,
    }: {
      targetStaffId: string;
      serviceId: string;
      durationMinutes: number;
      price: number;
    }) => {
      if (isAdmin) {
        return apiClient(`/staff/${targetStaffId}/services`, {
          method: "POST",
          body: JSON.stringify({ businessId, serviceId, durationMinutes, price }),
        });
      }
      if (targetStaffId !== myStaffId) {
        throw new Error("Forbidden");
      }
      return apiClient("/staff/me/services", {
        method: "POST",
        body: JSON.stringify({ serviceId, durationMinutes, price }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId, "serviceBoard"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      toast.success(t("widget.saved"));
      setBoardAddOpen(false);
    },
    onError: (e: Error) => toast.error(translateApiError(locale, e.message)),
  });

  const boardDeleteMutation = useMutation({
    mutationFn: async ({
      targetStaffId,
      staffServiceId,
    }: {
      targetStaffId: string;
      staffServiceId: string;
    }) => {
      if (isAdmin) {
        return apiClient(`/staff/${targetStaffId}/services/${staffServiceId}`, {
          method: "DELETE",
          body: JSON.stringify({ businessId }),
        });
      }
      if (targetStaffId !== myStaffId) {
        throw new Error("Forbidden");
      }
      return apiClient(`/staff/me/services/${staffServiceId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", businessId, "serviceBoard"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(translateApiError(locale, e.message)),
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

  const headerBranchTrusted =
    selectedBranchId && branches.some((b) => b.id === selectedBranchId)
      ? selectedBranchId
      : "";

  const resetForm = () =>
    setForm({
      name: "",
      durationMinutes: 30,
      price: 0,
      color: "#3B82F6",
      isActive: true,
      branchId:
        headerBranchTrusted ||
        (branches.length === 1 ? branches[0].id : "") ||
        "",
    });

  useEffect(() => {
    if (modal !== "add" || branches.length !== 1) return;
    setForm((p) =>
      p.branchId && branches.some((b) => b.id === p.branchId)
        ? p
        : { ...p, branchId: branches[0].id }
    );
  }, [modal, branches]);

  const boardCatalogKey = catalogForBoardAdd.map((s) => s.id).join(",");
  useEffect(() => {
    if (!boardAddOpen || catalogForBoardAdd.length === 0) return;
    setBoardAddCatalogId((prev) =>
      catalogForBoardAdd.some((s) => s.id === prev) ? prev : catalogForBoardAdd[0].id
    );
  }, [boardAddOpen, boardCatalogKey]);

  const openAdd = () => {
    resetForm();
    setEditing(null);
    setModal("add");
  };

  const openEdit = (service: ServiceItem) => {
    setForm({
      name: service.name,
      durationMinutes: service.durationMinutes,
      price: Number(service.price),
      color: service.color || "#3B82F6",
      isActive: service.isActive,
      branchId:
        service.branchId ??
        (selectedBranchId && branches.some((b) => b.id === selectedBranchId)
          ? selectedBranchId
          : ""),
    });
    setEditing(service);
    setModal("edit");
  };

  const openManageBlocks = (service: ServiceItem) => {
    setBlocksFor(service);
    setBlockAllStaff(!!service.blockAllStaff);
    setBlockedStaffIds([...(service.blockedStaffIds ?? [])]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal === "add") {
      createMutation.mutate({ ...form });
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
    const oldIndex = catalogListOrdered.findIndex((s) => s.id === active.id);
    const newIndex = catalogListOrdered.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const nextIds = arrayMove(
      catalogListOrdered.map((s) => s.id),
      oldIndex,
      newIndex
    );
    setCatalogOrderIds(nextIds);
    reorderMutation.mutate(nextIds);
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

  const err =
    createMutation.error ??
    updateMutation.error ??
    deleteMutation.error ??
    reorderMutation.error ??
    blocksMutation.error;
  const rawErrMsg = err instanceof Error ? err.message : err ? String(err) : "";
  const errMsg = rawErrMsg ? translateApiError(locale, rawErrMsg) : "";
  const boardErr =
    boardPatchMutation.error ?? boardAddMutation.error ?? boardDeleteMutation.error;
  const boardErrMsg =
    boardErr instanceof Error
      ? translateApiError(locale, boardErr.message)
      : boardErr
        ? translateApiError(locale, String(boardErr))
        : "";

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("nav.services")}
        </h1>
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            className="btn-primary inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:opacity-95 active:scale-[0.99] sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            {t("services.addServiceToArray")}
          </button>
        )}
      </header>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {errMsg}
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("services.serviceBoardTitle")}
        </h2>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          {t("services.serviceBoardSubtitle")}
        </p>
        {boardStaffLoading ? (
          <p className="text-sm text-zinc-500">{t("widget.loading")}</p>
        ) : boardStaffList.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("services.noStaffInBranch")}</p>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {t("services.selectStaffForServices")}
            </p>
            <StaffSelector
              staffList={boardStaffList.map((s) => ({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                avatarUrl: s.avatarUrl,
              }))}
              selected={boardSelectedStaffId}
              onSelect={setBoardSelectedStaffId}
              showAllOption={false}
            />
            {!canEditBoardSelection && (
              <p className="mt-3 text-xs text-amber-800 dark:text-amber-200/90">
                {t("services.readOnlyOtherStaff")}
              </p>
            )}
            {boardErrMsg && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{boardErrMsg}</p>
            )}
            {selectedBoardStaff && (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {selectedBoardStaff.firstName} {selectedBoardStaff.lastName}
                  </h3>
                  {canEditBoardSelection && (
                    <button
                      type="button"
                      disabled={catalogForBoardAdd.length === 0}
                      onClick={() => {
                        setBoardAddOpen(true);
                        setBoardAddDuration(30);
                        setBoardAddPrice(0);
                        const first = catalogForBoardAdd[0]?.id ?? "";
                        setBoardAddCatalogId(first);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                    >
                      <Plus className="h-4 w-4" />
                      {t("services.addServiceForStaffTitle")}
                    </button>
                  )}
                </div>
                {selectedBoardStaff.staffServices.length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("services.noServicesForStaff")}</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedBoardStaff.staffServices.map((ss) => {
                      const priceNum = Number(ss.price);
                      const svcInactive = ss.service.isActive === false;
                      return (
                        <li
                          key={ss.id}
                          className={`flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700 ${
                            !ss.allowBooking || svcInactive ? "opacity-80" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                              {ss.service.name}
                              {svcInactive && (
                                <span className="ms-2 text-xs font-normal text-zinc-500">
                                  ({t("services.inactiveCatalogService")})
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                              {t("services.duration")}: {ss.durationMinutes} · {t("services.price")}:{" "}
                              {priceNum}
                            </div>
                            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={ss.allowBooking}
                                disabled={!canEditBoardSelection || boardPatchMutation.isPending}
                                onChange={(e) =>
                                  boardPatchMutation.mutate({
                                    targetStaffId: boardSelectedStaffId,
                                    updates: [
                                      {
                                        staffServiceId: ss.id,
                                        allowBooking: e.target.checked,
                                      },
                                    ],
                                  })
                                }
                              />
                              <span>
                                {ss.allowBooking
                                  ? t("services.allowBooking")
                                  : t("services.bookingPaused")}
                              </span>
                            </label>
                          </div>
                          {canEditBoardSelection && (
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setBoardEditRow({
                                    staffServiceId: ss.id,
                                    name: ss.service.name,
                                    durationMinutes: ss.durationMinutes,
                                    price: priceNum,
                                  })
                                }
                                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                                aria-label={t("services.editStaffOffering")}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(t("services.confirmRemoveStaffService"))) {
                                    boardDeleteMutation.mutate({
                                      targetStaffId: boardSelectedStaffId,
                                      staffServiceId: ss.id,
                                    });
                                  }
                                }}
                                className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                aria-label={t("services.delete")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {isLoading ? (
        <p className="text-zinc-600 dark:text-zinc-400">{t("widget.loading")}</p>
      ) : services.length === 0 ? (
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
              items={catalogListOrdered.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {catalogListOrdered.map((service) => (
                <SortableServiceCard
                  key={service.id}
                  service={service}
                  isAdmin={!!isAdmin}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onManageBlocks={openManageBlocks}
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
              {modal === "add" ? t("services.addServiceToArray") : t("services.edit")}
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
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("services.addCatalogHint")}
                </p>
              )}
              {modal === "edit" && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("services.editCatalogHint")}
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

      {boardEditRow && canEditBoardSelection && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-lg font-semibold">
              {t("services.editStaffOffering")} – {boardEditRow.name}
            </h2>
            <div className="mt-4 flex flex-wrap gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.duration")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={boardEditRow.durationMinutes}
                  onChange={(e) =>
                    setBoardEditRow((p) =>
                      p
                        ? {
                            ...p,
                            durationMinutes: parseInt(e.target.value, 10) || 1,
                          }
                        : p
                    )
                  }
                  className="w-28 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.price")}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={boardEditRow.price}
                  onChange={(e) =>
                    setBoardEditRow((p) =>
                      p
                        ? { ...p, price: parseFloat(e.target.value) || 0 }
                        : p
                    )
                  }
                  className="w-32 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setBoardEditRow(null)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                disabled={boardPatchMutation.isPending}
                onClick={() =>
                  boardPatchMutation.mutate({
                    targetStaffId: boardSelectedStaffId,
                    updates: [
                      {
                        staffServiceId: boardEditRow.staffServiceId,
                        durationMinutes: boardEditRow.durationMinutes,
                        price: boardEditRow.price,
                      },
                    ],
                  })
                }
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {boardPatchMutation.isPending ? t("widget.loading") : t("services.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {boardAddOpen && canEditBoardSelection && boardSelectedStaffId && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-lg font-semibold">{t("services.addServiceForStaffTitle")}</h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              {t("services.addServiceForStaffHint")}
            </p>
            {catalogForBoardAdd.length === 0 ? (
              <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
                {t("services.noCatalogServicesAvailable")}
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("services.selectCatalogService")}
                  </label>
                  <select
                    value={boardAddCatalogId}
                    onChange={(e) => setBoardAddCatalogId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    {catalogForBoardAdd.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("services.duration")}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={boardAddDuration}
                      onChange={(e) =>
                        setBoardAddDuration(parseInt(e.target.value, 10) || 30)
                      }
                      className="w-28 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("services.price")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={boardAddPrice}
                      onChange={(e) =>
                        setBoardAddPrice(parseFloat(e.target.value) || 0)
                      }
                      className="w-32 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setBoardAddOpen(false)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                disabled={
                  !boardAddCatalogId ||
                  catalogForBoardAdd.length === 0 ||
                  boardAddMutation.isPending
                }
                onClick={() =>
                  boardAddMutation.mutate({
                    targetStaffId: boardSelectedStaffId,
                    serviceId: boardAddCatalogId,
                    durationMinutes: boardAddDuration,
                    price: boardAddPrice,
                  })
                }
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {boardAddMutation.isPending ? t("widget.loading") : t("services.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {blocksFor && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-lg font-semibold">
              {t("services.manageBlocks")} – {blocksFor.name}
            </h2>
            <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
              {t("services.blocksModalHint")}
            </p>
            <label className="mb-4 flex cursor-pointer items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-900/40 dark:bg-red-950/20">
              <input
                type="checkbox"
                checked={blockAllStaff}
                onChange={(e) => {
                  setBlockAllStaff(e.target.checked);
                  if (e.target.checked) setBlockedStaffIds([]);
                }}
              />
              <span className="text-sm font-medium">{t("services.blockAllStaff")}</span>
            </label>
            {!blockAllStaff && (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("services.blockStaffCheckHint")}
                </p>
                {staffList.map((staff) => (
                  <label
                    key={staff.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={blockedStaffIds.includes(staff.id)}
                      onChange={(e) => {
                        setBlockedStaffIds((p) =>
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
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setBlocksFor(null)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  blocksMutation.mutate({
                    serviceId: blocksFor.id,
                    payload: {
                      blockAllStaff,
                      blockedStaffIds: blockAllStaff ? [] : blockedStaffIds,
                    },
                  })
                }
                disabled={blocksMutation.isPending}
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {blocksMutation.isPending ? t("widget.loading") : t("services.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
