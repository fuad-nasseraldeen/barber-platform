"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Pencil, Clock, DollarSign, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

interface StaffServiceItem {
  id: string;
  durationMinutes: number;
  price: number;
  service: { id: string; name: string };
}

interface StaffProfile {
  id: string;
  firstName: string;
  lastName: string;
  staffServices: StaffServiceItem[];
}

interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  color: string | null;
  isActive: boolean;
  blockAllStaff?: boolean;
  blockedStaffIds?: string[];
}

export default function EmployeeServicesPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const [editing, setEditing] = useState<StaffServiceItem | null>(null);
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogServiceId, setCatalogServiceId] = useState("");
  const [addDuration, setAddDuration] = useState(30);
  const [addPrice, setAddPrice] = useState(0);
  const [customName, setCustomName] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);

  const { data: staff, isLoading } = useQuery<StaffProfile>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient<StaffProfile>("/staff/me"),
    enabled: !!businessId,
  });

  const { data: businessServices = [] } = useQuery<ServiceItem[]>({
    queryKey: ["services", businessId],
    queryFn: () =>
      apiClient<ServiceItem[]>(`/services?businessId=${businessId}&includeInactive=true`),
    enabled: !!businessId,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: { staffServiceId: string; durationMinutes?: number; price?: number }[]) =>
      apiClient<StaffProfile>("/staff/me/services", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      setEditing(null);
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addMutation = useMutation({
    mutationFn: (dto: {
      serviceId?: string;
      newServiceName?: string;
      durationMinutes: number;
      price: number;
    }) =>
      apiClient<StaffProfile>("/staff/me/services", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      setCatalogModalOpen(false);
      setCatalogServiceId("");
      setShowCustomForm(false);
      setCustomName("");
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (staffServiceId: string) =>
      apiClient(`/staff/me/services/${staffServiceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (ss: StaffServiceItem) => {
    setEditing(ss);
    setDuration(ss.durationMinutes);
    setPrice(Number(ss.price));
  };

  const handleSave = () => {
    if (!editing) return;
    updateMutation.mutate([
      { staffServiceId: editing.id, durationMinutes: duration, price },
    ]);
  };

  const assignedServiceIds = new Set((staff?.staffServices ?? []).map((ss) => ss.service.id));
  const availableServices = businessServices.filter((s) => {
    if (!s.isActive || assignedServiceIds.has(s.id)) return false;
    if (s.blockAllStaff) return false;
    if (staff?.id && (s.blockedStaffIds ?? []).includes(staff.id)) return false;
    return true;
  });

  const catalogKey = availableServices.map((s) => s.id).join(",");
  useEffect(() => {
    if (!catalogModalOpen || availableServices.length === 0) return;
    setCatalogServiceId((prev) =>
      availableServices.some((s) => s.id === prev)
        ? prev
        : availableServices[0].id
    );
  }, [catalogModalOpen, catalogKey]);

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  if (!staff) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("employee.profileNotFound")}</p>
      </div>
    );
  }

  const services = staff.staffServices ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("nav.services")}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {t("employee.servicesSubtitleCatalog")}
      </p>

      {availableServices.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setCatalogModalOpen(true);
            setAddDuration(30);
            setAddPrice(0);
          }}
          className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
        >
          {t("services.addPersonalService")}
        </button>
      )}

      {updateMutation.error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : t("employee.updateFailed")}
        </div>
      )}

      {services.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">{t("employee.myServices")}</h2>
          <div className="space-y-3">
            {services.map((ss) => (
              <div
                key={ss.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <div>
                  <h3 className="font-semibold">{ss.service.name}</h3>
                  <p className="flex items-center gap-4 text-sm text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {ss.durationMinutes} min
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-4 w-4" />
                      ₪{Number(ss.price).toFixed(0)}
                    </span>
                  </p>
                </div>
                {editing?.id === ss.id ? (
                  <div className="flex items-center gap-2">
                    <div>
                      <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")}</span>
                      <input
                        type="number"
                        min={1}
                        max={480}
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value, 10) || 30)}
                        className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    </div>
                    <div>
                      <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
                      <input
                        type="number"
                        min={0}
                        value={price}
                        onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                        className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={updateMutation.isPending}
                      className="btn-primary rounded-lg px-3 py-1 text-sm"
                    >
                      {t("staff.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-600"
                    >
                      {t("staff.cancel")}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(ss)}
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      aria-label={t("staff.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t("employee.removeServiceConfirm"))) removeMutation.mutate(ss.id);
                      }}
                      disabled={removeMutation.isPending}
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
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-medium">{t("employee.addCustomService")}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.addCustomServiceDesc")}</p>
        {!showCustomForm ? (
          <button
            type="button"
            onClick={() => setShowCustomForm(true)}
            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            {t("employee.addCustomServiceOpen")}
          </button>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[12rem] flex-1">
              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.name")}</span>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                placeholder={t("employee.customServiceNamePlaceholder")}
              />
            </div>
            <div>
              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")}</span>
              <input
                type="number"
                min={1}
                max={480}
                value={addDuration}
                onChange={(e) => setAddDuration(parseInt(e.target.value, 10) || 30)}
                className="w-24 rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
              <input
                type="number"
                min={0}
                value={addPrice}
                onChange={(e) => setAddPrice(parseFloat(e.target.value) || 0)}
                className="w-28 rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={addMutation.isPending || !customName.trim()}
                onClick={() =>
                  addMutation.mutate({
                    newServiceName: customName.trim(),
                    durationMinutes: addDuration,
                    price: addPrice,
                  })
                }
                className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("staff.save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm(false);
                  setCustomName("");
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
              >
                {t("staff.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {catalogModalOpen && (
        <div className="fixed inset-0 z-[100] flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-lg font-semibold">
              {t("services.addPersonalModalTitle")}
            </h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              {t("services.addPersonalModalHint")}
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("services.selectCatalogService")}
                </label>
                <select
                  value={catalogServiceId}
                  onChange={(e) => setCatalogServiceId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {availableServices.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name}
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
                    value={addDuration}
                    onChange={(e) =>
                      setAddDuration(parseInt(e.target.value, 10) || 30)
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
                    value={addPrice}
                    onChange={(e) =>
                      setAddPrice(parseFloat(e.target.value) || 0)
                    }
                    className="w-32 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setCatalogModalOpen(false);
                  setCatalogServiceId("");
                }}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("staff.cancel")}
              </button>
              <button
                type="button"
                disabled={!catalogServiceId || addMutation.isPending}
                onClick={() =>
                  addMutation.mutate({
                    serviceId: catalogServiceId,
                    durationMinutes: addDuration,
                    price: addPrice,
                  })
                }
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {addMutation.isPending ? t("widget.loading") : t("staff.save")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
