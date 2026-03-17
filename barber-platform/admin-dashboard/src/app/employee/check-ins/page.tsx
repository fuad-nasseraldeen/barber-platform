"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEmployeeStaffId } from "@/hooks/use-employee-staff-id";
import { useTranslation } from "@/hooks/use-translation";
import toast from "react-hot-toast";
import { UserCheck } from "lucide-react";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service: { name: string };
  customer: { firstName: string | null; lastName: string | null };
};

type AppointmentsResponse = { appointments: Appointment[] };

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatTime(s: string) {
  return s.slice(11, 16);
}

export default function EmployeeCheckInsPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const staffId = useEmployeeStaffId();
  const queryClient = useQueryClient();
  const today = formatDate(new Date());

  const { data, isLoading } = useQuery<AppointmentsResponse>({
    queryKey: ["appointments", businessId, staffId, today, "checkin"],
    queryFn: () =>
      apiClient(
        `/appointments?businessId=${businessId}&staffId=${staffId}&startDate=${today}&endDate=${today}&status=CONFIRMED&limit=50`
      ),
    enabled: !!businessId && !!staffId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient(`/appointments/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ businessId, status: "COMPLETED" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Customer marked as arrived");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const appointments = data?.appointments ?? [];
  const pending = appointments.filter((a) => a.status === "CONFIRMED" || a.status === "PENDING");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("employee.arrivalConfirmations")}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {t("employee.confirmArrivalSubtitle")}
      </p>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-12 dark:border-zinc-600">
          <UserCheck className="mb-4 h-12 w-12 text-zinc-400" />
          <p className="text-zinc-500">{t("employee.noPendingArrivals")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((apt) => (
            <div
              key={apt.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div>
                <p className="font-semibold">
                  {apt.customer.firstName} {apt.customer.lastName}
                </p>
                <p className="text-sm text-zinc-500">{apt.service.name}</p>
                <p className="text-sm text-zinc-500">{formatTime(apt.startTime)}</p>
              </div>
              <button
                onClick={() => updateMutation.mutate({ id: apt.id })}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                <UserCheck className="h-4 w-4" /> {t("employee.confirmArrived")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
