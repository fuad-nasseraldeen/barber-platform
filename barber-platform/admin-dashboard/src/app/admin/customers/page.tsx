"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useTranslation } from "@/hooks/use-translation";
import { useLocaleStore } from "@/stores/locale-store";
import { translateApiError } from "@/lib/i18n";
import Link from "next/link";
import toast from "react-hot-toast";
import { Search, Pencil, Trash2, Plus } from "lucide-react";
import { CustomerListSkeleton } from "@/components/ui/skeleton";
import { BirthDateTripleInput } from "@/components/ui/birth-date-triple-input";
import { GenderToggle, type GenderToggleValue } from "@/components/ui/gender-toggle";
import { CUSTOMER_TAG_COLORS_HEX } from "@/lib/customer-tag-colors";

export interface CustomerItem {
  id: string;
  businessId: string;
  branchId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  tagColor: string | null;
  notes: string | null;
  branch?: { id: string; name: string } | null;
  noShowRisk?: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    flagged: boolean;
    noShowCount: number;
    totalAppointments: number;
  };
}

interface CustomerForm {
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  gender: string;
  tagColor: string;
  branchId: string;
  notes: string;
}

function isValidCustomerPhone(phoneTrim: string): boolean {
  return phoneTrim.length >= 6 && phoneTrim.length <= 30;
}

export default function AdminCustomersPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const dir = useLocaleStore((s) => s.dir);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const selectedBranchId = useEffectiveBranchId(businessId);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [form, setForm] = useState<CustomerForm>({
    firstName: "",
    lastName: "",
    phone: "",
    birthDate: "",
    gender: "FEMALE",
    tagColor: CUSTOMER_TAG_COLORS_HEX[0],
    branchId: "",
    notes: "",
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const queryParams = new URLSearchParams({ businessId: businessId || "" });
  if (selectedBranchId !== null && selectedBranchId !== "") {
    queryParams.set("branchId", selectedBranchId);
  }
  if (debouncedSearch) queryParams.set("search", debouncedSearch);

  const { data: customers = [], isLoading } = useQuery<CustomerItem[]>({
    queryKey: ["customers", businessId, selectedBranchId, debouncedSearch],
    queryFn: () =>
      apiClient<CustomerItem[]>(`/customers?${queryParams.toString()}`),
    enabled: !!businessId,
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const resetAddForm = () =>
    setForm({
      firstName: "",
      lastName: "",
      phone: "",
      birthDate: "",
      gender: "FEMALE",
      tagColor: CUSTOMER_TAG_COLORS_HEX[0],
      branchId: selectedBranchId || "",
      notes: "",
    });

  const createMutation = useMutation({
    mutationFn: (data: CustomerForm) =>
      apiClient<CustomerItem>("/customers", {
        method: "POST",
        body: JSON.stringify({
          businessId,
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          phone: data.phone.trim(),
          gender: data.gender,
          birthDate: data.birthDate || undefined,
          branchId: data.branchId || undefined,
          tagColor: data.tagColor || undefined,
          notes: data.notes.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] });
      setModal(null);
      setEditing(null);
      createMutation.reset();
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => {
      toast.error(translateApiError(locale, e.message));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerForm }) =>
      apiClient<CustomerItem>(`/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          firstName: data.firstName || undefined,
          lastName: data.lastName || undefined,
          phone: data.phone || undefined,
          birthDate: data.birthDate || undefined,
          gender: data.gender || undefined,
          tagColor: data.tagColor || undefined,
          branchId: data.branchId || undefined,
          notes: data.notes || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] });
      setModal(null);
      setEditing(null);
      updateMutation.reset();
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => {
      toast.error(translateApiError(locale, e.message));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient<{ success: boolean }>(`/customers/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ businessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] });
      setModal(null);
      setEditing(null);
      deleteMutation.reset();
    },
    onError: (e: Error) => {
      toast.error(translateApiError(locale, e.message));
    },
  });

  const closeModal = () => {
    setModal(null);
    setEditing(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const openAdd = () => {
    createMutation.reset();
    updateMutation.reset();
    setEditing(null);
    resetAddForm();
    setModal("add");
  };

  const openEdit = (customer: CustomerItem) => {
    setForm({
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      phone: customer.phone ?? "",
      birthDate: customer.birthDate ? customer.birthDate.slice(0, 10) : "",
      gender: customer.gender ?? "",
      tagColor: customer.tagColor ?? CUSTOMER_TAG_COLORS_HEX[0],
      branchId: customer.branchId ?? "",
      notes: customer.notes ?? "",
    });
    createMutation.reset();
    updateMutation.reset();
    setEditing(customer);
    setModal("edit");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal === "add") {
      const phoneTrim = form.phone.trim();
      if (!form.firstName.trim() || !form.lastName.trim() || !phoneTrim || !form.gender) {
        toast.error(t("customers.validationFillRequired"));
        return;
      }
      if (!isValidCustomerPhone(phoneTrim)) {
        toast.error(t("customers.phoneLengthInvalid"));
        return;
      }
      createMutation.mutate(form);
    } else if (modal === "edit" && editing) {
      const phoneTrim = form.phone.trim();
      if (phoneTrim && !isValidCustomerPhone(phoneTrim)) {
        toast.error(t("customers.phoneLengthInvalid"));
        return;
      }
      updateMutation.mutate({ id: editing.id, data: form });
    }
  };

  const customerName = (c: CustomerItem) =>
    [c.firstName, c.lastName].filter(Boolean).join(" ") || c.phone || "—";

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.customers")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Please log in to view customers.</p>
      </div>
    );
  }

  const err = createMutation.error ?? updateMutation.error ?? deleteMutation.error;
  const rawMsg = err instanceof Error ? err.message : err ? String(err) : "";
  const errMsg = rawMsg
    ? rawMsg === "PHONE_BLOCKED"
      ? t("customers.phoneBlocked")
      : translateApiError(locale, rawMsg)
    : "";

  const modalMutationError = modal === "add" ? createMutation.error : updateMutation.error;
  const modalMutationMsg =
    modalMutationError instanceof Error
      ? translateApiError(locale, modalMutationError.message)
      : "";

  const phoneTrimmed = form.phone.trim();
  const phoneLengthWarning =
    phoneTrimmed.length > 0 && !isValidCustomerPhone(phoneTrimmed);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.customers")}</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">{t("customers.subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            {t("customers.add")}
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("customers.search")}
            className="w-full rounded-lg border border-zinc-300 py-2 pl-10 pr-4 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
      </div>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {errMsg}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <CustomerListSkeleton rows={8} />
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">{t("customers.empty")}</p>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="btn-primary mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              {t("customers.add")}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <table dir={dir} className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "20%" }} />
              {isAdmin ? <col style={{ width: "6%" }} /> : null}
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-4 py-3 text-start font-medium">{t("customers.firstName")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("customers.lastName")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("customers.phone")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("customers.branch")}</th>
                {isAdmin && <th className="w-24 px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => {
                const isNoShowFlagged = customer.noShowRisk?.flagged;
                const isHighRisk = customer.noShowRisk?.level === "HIGH";
                return (
                <tr
                  key={customer.id}
                  className={`border-b border-zinc-100 dark:border-zinc-700/50 ${
                    isNoShowFlagged
                      ? "bg-rose-50/70 dark:bg-rose-900/10"
                      : ""
                  }`}
                >
                  <td className="px-4 py-3 text-start">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="flex items-center gap-2 font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      <div
                        className="h-8 w-8 shrink-0 rounded-full"
                        style={{
                          backgroundColor: customer.tagColor || "#94a3b8",
                        }}
                      />
                      <span className="inline-flex items-center gap-2">
                        {customer.firstName || "—"}
                        {isNoShowFlagged ? (
                          <span
                            title={`No-Show risk (${customer.noShowRisk?.score ?? 0}%)`}
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              isHighRisk ? "bg-red-600" : "bg-amber-500"
                            }`}
                          />
                        ) : null}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-start">{customer.lastName || "—"}</td>
                  <td className="px-4 py-3 text-start">{customer.phone || "—"}</td>
                  <td className="px-4 py-3 text-start">
                    {customer.branch?.name
                      ? /^main\s*branch$/i.test(customer.branch.name)
                        ? t("branches.mainBranch")
                        : customer.branch.name
                      : "—"}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(customer)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                          aria-label={t("customers.edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t("customers.confirmDelete"))) {
                              deleteMutation.mutate(customer.id);
                            }
                          }}
                          className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label={t("customers.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {portalReady &&
        modal &&
        (modal === "add" || editing) &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center bg-black/70 p-4 pb-24 lg:pb-4">
          <div className="max-h-[min(90dvh,calc(100dvh-8rem))] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 pb-8 shadow-lg lg:max-h-[90vh] dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">
              {modal === "add" ? t("customers.add") : t("customers.edit")}
            </h2>
            {modalMutationMsg && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {modalMutationMsg}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("customers.firstName")}</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("customers.lastName")}</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("customers.phone")}</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="050xxxxxxxx"
                  minLength={6}
                  maxLength={30}
                  className={`w-full rounded-lg border px-4 py-2 dark:bg-zinc-800 dark:text-zinc-100 ${
                    phoneLengthWarning
                      ? "border-amber-500 ring-1 ring-amber-400 dark:border-amber-500"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  required
                />
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("customers.phoneHint")}</p>
                {phoneLengthWarning && (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t("customers.phoneLengthInvalid")}
                  </p>
                )}
              </div>
              <BirthDateTripleInput
                labelKey="customers.birthDate"
                value={form.birthDate}
                onChange={(iso) => setForm((p) => ({ ...p, birthDate: iso }))}
              />
              <GenderToggle
                labelKey="customers.gender"
                value={form.gender as GenderToggleValue}
                onChange={(v) => setForm((p) => ({ ...p, gender: v }))}
                allowOther
              />
              <div>
                <label className="mb-1 block text-sm font-medium">{t("customers.tagColor")}</label>
                <div className="flex flex-wrap gap-2">
                  {CUSTOMER_TAG_COLORS_HEX.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, tagColor: c }))}
                      className={`h-8 w-8 rounded-full border-2 ${
                        form.tagColor === c ? "border-zinc-900 dark:border-zinc-100" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Select ${c}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={form.tagColor}
                    onChange={(e) => setForm((p) => ({ ...p, tagColor: e.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("customers.branch")}</label>
                <select
                  value={form.branchId}
                  onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="">—</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {/^main\s*branch$/i.test(b.name) ? t("branches.mainBranch") : b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("customers.notes")}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
                >
                  {t("customers.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending || createMutation.isPending}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {updateMutation.isPending || createMutation.isPending
                    ? t("widget.loading")
                    : t("customers.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
