"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Users } from "lucide-react";
import toast from "react-hot-toast";

export default function EmployeesSettingsPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        requireEmployeeVacationApproval?: boolean;
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const updateMutation = useMutation({
    mutationFn: (requireEmployeeVacationApproval: boolean) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({ requireEmployeeVacationApproval }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business", businessId] });
      toast.success(t("settings.settingsSaved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  if (!businessId) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
      <h1 className="mb-2 flex items-center gap-2 text-xl font-semibold">
        <Users className="h-6 w-6 text-emerald-600" />
        {t("settings.employees")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("settings.vacationApprovalDesc")}
      </p>
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={business?.requireEmployeeVacationApproval ?? true}
          onChange={(e) => updateMutation.mutate(e.target.checked)}
          disabled={updateMutation.isPending}
        />
        <span className="text-sm">{t("settings.vacationApproval")}</span>
      </label>
    </div>
  );
}
