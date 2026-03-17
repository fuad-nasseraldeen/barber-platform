"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchStore } from "@/stores/branch-store";
import { useTranslation } from "@/hooks/use-translation";
import { useLocaleStore } from "@/stores/locale-store";
import Link from "next/link";
import { Search } from "lucide-react";
import { SortUpArrow, SortDownArrow } from "@/components/ui/nav-arrow";

type Appointment = {
  id: string;
  startTime: string;
  status: string;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    tagColor: string | null;
  };
};

type AppointmentsResponse = { appointments: Appointment[]; total: number };

function formatDate(s: string, locale: string) {
  return new Date(s).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function getInitials(firstName: string | null, lastName: string | null, email: string) {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

type SortKey = "date" | "name";
type SortDir = "asc" | "desc";

export default function ArrivalConfirmationsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const today = new Date().toISOString().slice(0, 10);
  const oneMonthLater = new Date();
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  const endDate = oneMonthLater.toISOString().slice(0, 10);

  const queryParams = new URLSearchParams({
    businessId: businessId || "",
    status: "CONFIRMED",
    startDate: today,
    endDate,
    limit: "200",
  });
  if (selectedBranchId) queryParams.set("branchId", selectedBranchId);

  const { data, isLoading } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", "arrival-confirmations", businessId, selectedBranchId, today, endDate],
    queryFn: () => apiClient<AppointmentsResponse>(`/appointments?${queryParams}`),
    enabled: !!businessId,
  });

  const appointments = data?.appointments ?? [];

  const filtered = useMemo(() => {
    let list = appointments;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      list = list.filter((a) => {
        const name = [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ").toLowerCase();
        const phone = (a.customer.phone ?? "").toLowerCase();
        return name.includes(q) || phone.includes(q) || a.customer.email.toLowerCase().includes(q);
      });
    }
    list = [...list].sort((a, b) => {
      if (sortKey === "date") {
        const da = new Date(a.startTime).getTime();
        const db = new Date(b.startTime).getTime();
        return sortDir === "asc" ? da - db : db - da;
      }
      const na = [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ");
      const nb = [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ");
      return sortDir === "asc" ? na.localeCompare(nb) : nb.localeCompare(na);
    });
    return list;
  }, [appointments, debouncedSearch, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((a) => a.id)));
  };

  if (!businessId) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">Please log in to view this page.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("arrivalConfirmations.title")}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {t("arrivalConfirmations.settingsLinkPrefix")}{" "}
        <Link
          href="/admin/settings/arrival-confirmation"
          className="font-medium text-primary underline decoration-primary underline-offset-2 hover:opacity-90"
        >
          {t("arrivalConfirmations.clickHere")}
        </Link>
      </p>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">{t("arrivalConfirmations.search")}</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("arrivalConfirmations.searchPlaceholder")}
            className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">{t("arrivalConfirmations.empty")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort("date")}
                      className="flex items-center gap-1 font-medium hover:text-primary"
                    >
                      {t("arrivalConfirmations.toDate")}
                      {sortKey === "date" ? (
                        sortDir === "asc" ? (
                          <SortUpArrow className="h-4 w-4" />
                        ) : (
                          <SortDownArrow className="h-4 w-4" />
                        )
                      ) : null}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-1 font-medium hover:text-primary"
                    >
                      {t("arrivalConfirmations.fullName")}
                      {sortKey === "name" ? (
                        sortDir === "asc" ? (
                          <SortUpArrow className="h-4 w-4" />
                        ) : (
                          <SortDownArrow className="h-4 w-4" />
                        )
                      ) : null}
                    </button>
                  </th>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="rounded border-zinc-300"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((apt) => {
                  const name = [apt.customer.firstName, apt.customer.lastName].filter(Boolean).join(" ") || apt.customer.email;
                  const initials = getInitials(apt.customer.firstName, apt.customer.lastName, apt.customer.email);
                  const color = apt.customer.tagColor || "#94a3b8";
                  return (
                    <tr
                      key={apt.id}
                      className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-700/50"
                    >
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {formatDate(apt.startTime, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
                            style={{ backgroundColor: color }}
                          >
                            {initials}
                          </div>
                          <span className="font-medium">{name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(apt.id)}
                          onChange={() => toggleSelect(apt.id)}
                          className="rounded border-zinc-300"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
