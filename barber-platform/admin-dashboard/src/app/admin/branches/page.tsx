"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { PlaceAutocomplete, type PlaceData } from "@/components/ui/place-autocomplete";
import type { Branch } from "@/stores/branch-store";
import { Plus, Pencil, Trash2, MapPin, Phone } from "lucide-react";

export default function AdminBranchesPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
    phone: "",
    copyFromBranchId: "" as string,
    copyServices: false,
    moveStaffIds: [] as string[],
  });

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<Branch[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const { data: sourceStaffRaw = [] } = useQuery<
    { id: string; firstName: string; lastName: string }[]
  >({
    queryKey: ["staff", businessId, form.copyFromBranchId],
    queryFn: () =>
      apiClient<{ id: string; firstName: string; lastName: string }[]>(
        `/staff?businessId=${businessId}&branchId=${form.copyFromBranchId}&includeInactive=true&page=1&limit=100`
      ),
    enabled: !!businessId && !!form.copyFromBranchId && modal === "add",
  });
  const sourceStaff = Array.isArray(sourceStaffRaw) ? sourceStaffRaw : [];

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiClient<Branch>("/branches", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          name: data.name,
          address: data.address || undefined,
          city: data.city || undefined,
          lat: data.lat,
          lng: data.lng,
          phone: data.phone || undefined,
          copyFromBranchId: data.copyFromBranchId || undefined,
          copyServices: data.copyServices || undefined,
          moveStaffIds: data.moveStaffIds?.length ? data.moveStaffIds : undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches", businessId] });
      setModal(null);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof form }) =>
      apiClient<Branch>(`/branches/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          name: data.name,
          address: data.address || undefined,
          city: data.city || undefined,
          lat: data.lat,
          lng: data.lng,
          phone: data.phone || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches", businessId] });
      setModal(null);
      setEditing(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<{ success: boolean }>(`/branches/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches", businessId] });
      setModal(null);
      setEditing(null);
    },
  });

  const resetForm = () =>
    setForm({
      name: "",
      address: "",
      city: "",
      lat: undefined,
      lng: undefined,
      phone: "",
      copyFromBranchId: "",
      copyServices: false,
      moveStaffIds: [],
    });

  const openAdd = () => {
    resetForm();
    setEditing(null);
    setModal("add");
  };

  const openEdit = (branch: Branch) => {
    setForm({
      name: branch.name,
      address: branch.address ?? "",
      city: branch.city ?? "",
      lat: branch.lat ?? undefined,
      lng: branch.lng ?? undefined,
      phone: branch.phone ?? "",
    });
    setEditing(branch);
    setModal("edit");
  };

  const handlePlaceSelect = useCallback((value: string, place?: PlaceData) => {
    setForm((prev) => ({
      ...prev,
      address: place?.address ?? value,
      city: place?.city ?? prev.city,
      lat: place?.lat,
      lng: place?.lng,
    }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal === "add") {
      createMutation.mutate(form);
    } else if (modal === "edit" && editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    }
  };

  const handleDelete = (branch: Branch) => {
    if (confirm(`${t("branches.confirmDelete")} "${branch.name}"?`)) {
      deleteMutation.mutate(branch.id);
    }
  };

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.branches")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view branches.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.branches")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("widget.loading")}</p>
      </div>
    );
  }

  const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;
  const errMsg = error instanceof Error ? error.message : error ? String(error) : "";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.branches")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {t("branches.subtitle")}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            {t("branches.add")}
          </button>
        )}
      </div>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {errMsg}
        </div>
      )}

      {branches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">
            {t("branches.empty")}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              {t("branches.addFirst")}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{branch.name}</h3>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(branch)}
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      aria-label={t("branches.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(branch)}
                      className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      aria-label={t("branches.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              {branch.address && (
                <div className="mt-2 flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {branch.address}
                    {branch.city && `, ${branch.city}`}
                  </span>
                </div>
              )}
              {branch.phone && (
                <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <Phone className="h-4 w-4 shrink-0" />
                  <span>{branch.phone}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">
              {modal === "add" ? t("branches.add") : t("branches.edit")}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("branches.name")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("branches.location")}
                </label>
                <PlaceAutocomplete
                  value={form.address}
                  onChange={handlePlaceSelect}
                  placeholder={t("branches.locationPlaceholder")}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("branches.phone")}
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="050xxxxxxxx"
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              {modal === "add" && branches.length > 1 && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("branches.copyFrom")}
                    </label>
                    <select
                      value={form.copyFromBranchId}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          copyFromBranchId: e.target.value,
                          moveStaffIds: [],
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="">{t("branches.selectSourceBranch")}</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.copyFromBranchId && (
                    <>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.copyServices}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, copyServices: e.target.checked }))
                          }
                        />
                        <span className="text-sm">{t("branches.copyServices")}</span>
                      </label>
                      {sourceStaff.length > 0 && (
                        <div>
                          <label className="mb-1 block text-sm font-medium">
                            {t("branches.moveStaff")}
                          </label>
                          <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-600">
                            {sourceStaff.map((s) => (
                              <label
                                key={s.id}
                                className="flex cursor-pointer items-center gap-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={form.moveStaffIds.includes(s.id)}
                                  onChange={(e) => {
                                    setForm((p) => ({
                                      ...p,
                                      moveStaffIds: e.target.checked
                                        ? [...p.moveStaffIds, s.id]
                                        : p.moveStaffIds.filter((id) => id !== s.id),
                                    }));
                                  }}
                                />
                                <span className="text-sm">
                                  {s.firstName} {s.lastName}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
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
                  {t("branches.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t("widget.loading")
                    : modal === "add"
                    ? t("branches.add")
                    : t("branches.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
