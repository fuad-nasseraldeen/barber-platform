"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Pencil, Clock, DollarSign, Plus, Trash2 } from "lucide-react";
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
}

export default function EmployeeServicesPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const [editing, setEditing] = useState<StaffServiceItem | null>(null);
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  const [addingServiceId, setAddingServiceId] = useState<string | null>(null);
  const [addDuration, setAddDuration] = useState(30);
  const [addPrice, setAddPrice] = useState(0);

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
    mutationFn: (dto: { serviceId: string; durationMinutes: number; price: number }) =>
      apiClient<StaffProfile>("/staff/me/services", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      setAddingServiceId(null);
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
  const availableServices = businessServices.filter((s) => s.isActive && !assignedServiceIds.has(s.id));

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
        {t("employee.servicesSubtitle")}
      </p>

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

      {availableServices.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">{t("employee.addService")}</h2>
          <p className="text-sm text-zinc-500">{t("employee.addServiceDesc")}</p>
          <div className="flex flex-wrap gap-3">
            {availableServices.map((svc) => (
              <div
                key={svc.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <div
                  className="h-10 w-10 shrink-0 rounded-lg"
                  style={{ backgroundColor: svc.color || "#94a3b8" }}
                />
                <div>
                  <p className="font-medium">{svc.name}</p>
                  {addingServiceId === svc.id ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div>
                        <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")}</span>
                        <input
                          type="number"
                          min={1}
                          max={480}
                          value={addDuration}
                          onChange={(e) => setAddDuration(parseInt(e.target.value, 10) || 30)}
                          className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      </div>
                      <div>
                        <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
                        <input
                          type="number"
                          min={0}
                          value={addPrice}
                          onChange={(e) => setAddPrice(parseFloat(e.target.value) || 0)}
                          className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          addMutation.mutate({
                            serviceId: svc.id,
                            durationMinutes: addDuration,
                            price: addPrice,
                          });
                        }}
                        disabled={addMutation.isPending}
                        className="btn-primary rounded-lg px-3 py-1 text-sm"
                      >
                        {t("staff.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingServiceId(null)}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-600"
                      >
                        {t("staff.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingServiceId(svc.id);
                        setAddDuration(svc.durationMinutes);
                        setAddPrice(Number(svc.price));
                      }}
                      className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <Plus className="h-4 w-4" />
                      {t("employee.addWithPrice")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {services.length === 0 && availableServices.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">
            {t("employee.noServicesAssigned")}
          </p>
        </div>
      )}
    </div>
  );
}
