"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import Link from "next/link";
import { BackArrow } from "@/components/ui/nav-arrow";
import { Calendar, Scissors } from "lucide-react";

type Customer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  tagColor: string | null;
  notes: string | null;
  branch?: { id: string; name: string } | null;
};

type CustomerVisit = {
  id: string;
  visitDate: string;
  status: string;
  price: number;
  staff: { firstName: string; lastName: string };
  service: { name: string };
};

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff: { firstName: string; lastName: string };
  service: { name: string };
  branch?: { name: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  NO_SHOW: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  IN_PROGRESS: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
};

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const customerId = params.id as string;

  const { data: customer, isLoading: customerLoading } = useQuery<Customer>({
    queryKey: ["customer", customerId, businessId],
    queryFn: () =>
      apiClient<Customer>(`/customers/${customerId}?businessId=${businessId}`),
    enabled: !!businessId && !!customerId,
  });

  const { data: visits = [] } = useQuery<CustomerVisit[]>({
    queryKey: ["customer-visits", customerId, businessId],
    queryFn: () =>
      apiClient<CustomerVisit[]>(
        `/customer-visits/customer/${customerId}?businessId=${businessId}&limit=20`
      ),
    enabled: !!businessId && !!customerId,
  });

  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: appointmentsData } = useQuery<{ appointments: Appointment[] }>({
    queryKey: ["appointments", businessId, customerId],
    queryFn: () =>
      apiClient<{ appointments: Appointment[] }>(
        `/appointments?businessId=${businessId}&customerId=${customerId}&startDate=${longAgo}&endDate=${farFuture}&limit=100`
      ),
    enabled: !!businessId && !!customerId,
  });

  const now = new Date();
  const allAppointments = appointmentsData?.appointments ?? [];
  const upcomingAppointments = allAppointments.filter(
    (a) =>
      new Date(a.startTime) >= now &&
      !["CANCELLED", "NO_SHOW"].includes(a.status)
  );
  const pastAppointments = allAppointments
    .filter(
      (a) =>
        new Date(a.startTime) < now ||
        ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)
    )
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  if (!businessId) {
    router.replace("/login");
    return null;
  }

  if (customerLoading || !customer) {
    return (
      <div>
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email;

  return (
    <div>
      <Link
        href="/admin/customers"
        className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <BackArrow className="h-4 w-4" />
        {t("nav.customers")}
      </Link>

      <div className="mb-8 flex items-start gap-4">
        <div
          className="h-16 w-16 shrink-0 rounded-full"
          style={{ backgroundColor: customer.tagColor || "#94a3b8" }}
        />
        <div>
          <h1 className="text-2xl font-semibold">{customerName}</h1>
          <p className="text-zinc-600 dark:text-zinc-400">{customer.email}</p>
          {customer.phone && (
            <p className="text-sm text-zinc-500">{customer.phone}</p>
          )}
          {customer.branch && (
            <p className="text-sm text-zinc-500">
              {/^main\s*branch$/i.test(customer.branch.name)
                ? t("branches.mainBranch")
                : customer.branch.name}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming appointments */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Calendar className="h-5 w-5" />
            {t("customers.upcomingAppointments")}
          </h2>
          {upcomingAppointments.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("customers.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {upcomingAppointments.map((apt) => {
                const start = new Date(apt.startTime);
                const statusClass = STATUS_COLORS[apt.status] ?? "bg-zinc-100";
                return (
                  <li
                    key={apt.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
                  >
                    <div>
                      <p className="font-medium">{apt.service.name}</p>
                      <p className="text-sm text-zinc-500">
                        {start.toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {apt.staff.firstName} {apt.staff.lastName}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                    >
                      {apt.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Past appointments */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Calendar className="h-5 w-5" />
            {t("customers.pastAppointments")}
          </h2>
          {pastAppointments.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("customers.empty")}</p>
          ) : (
            <>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {pastAppointments.slice(0, 10).map((apt) => {
                  const start = new Date(apt.startTime);
                  const statusClass = STATUS_COLORS[apt.status] ?? "bg-zinc-100";
                  return (
                    <li
                      key={apt.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
                    >
                      <div>
                        <p className="font-medium">{apt.service.name}</p>
                        <p className="text-sm text-zinc-500">
                          {start.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" · "}
                          {apt.staff.firstName} {apt.staff.lastName}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                      >
                        {apt.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {pastAppointments.length > 10 && (
                <p className="mt-2 text-xs text-zinc-500">
                  +{pastAppointments.length - 10} more
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Visit history */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Scissors className="h-5 w-5" />
          {t("customers.visitHistory")}
        </h2>
        {visits.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("customers.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Service</th>
                  <th className="px-4 py-2 text-left font-medium">Staff</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const statusClass = STATUS_COLORS[v.status] ?? "bg-zinc-100";
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-zinc-100 dark:border-zinc-700/50"
                    >
                      <td className="px-4 py-2">
                        {new Date(v.visitDate).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2">{v.service.name}</td>
                      <td className="px-4 py-2">
                        {v.staff.firstName} {v.staff.lastName}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${statusClass}`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">{Number(v.price).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
