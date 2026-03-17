"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEmployeeStaffId } from "@/hooks/use-employee-staff-id";
import { useTranslation } from "@/hooks/use-translation";
import { DollarSign } from "lucide-react";

type Appointment = {
  id: string;
  status: string;
  service: { name: string; durationMinutes: number };
};

type AppointmentsResponse = { appointments: Appointment[] };

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getRange(
  filter: string,
  customStart?: string,
  customEnd?: string
): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (filter === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  if (filter === "day") {
    return { start: formatDate(today), end: formatDate(today) };
  }
  if (filter === "week") {
    const day = today.getDay();
    const start = new Date(today);
    start.setDate(today.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: formatDate(start), end: formatDate(end) };
  }
  if (filter === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: formatDate(start), end: formatDate(end) };
  }
  return { start: formatDate(today), end: formatDate(today) };
}

export default function EmployeeEarningsPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const staffId = useEmployeeStaffId();
  const [filter, setFilter] = useState<"day" | "week" | "month" | "custom">("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { start, end } = getRange(filter, customStart, customEnd);

  const { data, isLoading } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, staffId, start, end, "earnings"],
    queryFn: () =>
      apiClient(
        `/appointments?businessId=${businessId}&staffId=${staffId}&startDate=${start}&endDate=${end}&status=COMPLETED&limit=500`
      ),
    enabled: !!businessId && !!staffId,
  });

  const appointments = data?.appointments ?? [];
  const totalServices = appointments.length;
  // Earnings would need service price from API - placeholder
  const grossEarnings = 0;
  const netEarnings = 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("employee.earningsTitle")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        {(["day", "week", "month", "custom"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              filter === f
                ? "btn-primary"
                : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            }`}
          >
            {f === "custom" ? t("employee.dateRange") : t(`employee.${f}`)}
          </button>
        ))}
        {filter === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="min-h-11 rounded-xl border-2 border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <span className="text-zinc-500">–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="min-h-11 rounded-xl border-2 border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
                <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.servicesCompleted")}</p>
                <p className="text-2xl font-bold">{totalServices}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
                <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.grossEarnings")}</p>
                <p className="text-2xl font-bold">₪{grossEarnings.toFixed(0)}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-teal-100 p-2 dark:bg-teal-900/30">
                <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("employee.netEarnings")}</p>
                <p className="text-2xl font-bold">₪{netEarnings.toFixed(0)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm text-zinc-500">
        {t("employee.earningsSummary").replace("{start}", start).replace("{end}", end)}
      </p>
    </div>
  );
}
