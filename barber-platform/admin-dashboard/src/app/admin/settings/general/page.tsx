"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Settings2 } from "lucide-react";
import toast from "react-hot-toast";

const GS_KEYS = [
  { key: "sendArrivalConfirmationSms", labelKey: "settings.gs.sendArrivalConfirmationSms", implemented: true },
  { key: "allowCustomerRegistration", labelKey: "settings.gs.allowCustomerRegistration", implemented: false },
  { key: "sabbathMode", labelKey: "settings.gs.sabbathMode", implemented: false },
  { key: "showCustomerPhoneToEmployees", labelKey: "settings.gs.showCustomerPhoneToEmployees", implemented: false },
  { key: "enableQuickBookingPage", labelKey: "settings.gs.enableQuickBookingPage", implemented: false },
  { key: "enableChat", labelKey: "settings.gs.enableChat", implemented: false },
  { key: "enableWaitlistNotifications", labelKey: "settings.gs.enableWaitlistNotifications", implemented: false },
  { key: "hideOldUpdates", labelKey: "settings.gs.hideOldUpdates", implemented: false },
  { key: "allowVacationInAppointmentPage", labelKey: "settings.gs.allowVacationInAppointmentPage", implemented: false },
  { key: "hideStatistics", labelKey: "settings.gs.hideStatistics", implemented: false },
  { key: "hidePopupAlerts", labelKey: "settings.gs.hidePopupAlerts", implemented: false },
  { key: "hideEmployeeStatistics", labelKey: "settings.gs.hideEmployeeStatistics", implemented: false },
  { key: "disableScrollOnAppointmentPage", labelKey: "settings.gs.disableScrollOnAppointmentPage", implemented: false },
] as const;

export default function GeneralSettingsPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        settings?: { generalSettings?: Record<string, boolean> };
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const gs = business?.settings?.generalSettings ?? {};

  const updateMutation = useMutation({
    mutationFn: (generalSettings: Record<string, boolean>) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            ...business?.settings,
            generalSettings: { ...gs, ...generalSettings },
          },
        }),
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
        <Settings2 className="h-6 w-6 text-blue-600" />
        {t("settings.generalSettings")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("settings.generalSettingsDesc")}
      </p>
      <div className="space-y-3">
        {GS_KEYS.map(({ key, labelKey, implemented }) => (
          <label key={key} className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={gs[key as keyof typeof gs] ?? false}
              onChange={(e) =>
                updateMutation.mutate({
                  [key]: e.target.checked,
                })
              }
              disabled={updateMutation.isPending}
            />
            <span className="flex-1 text-sm">{t(labelKey)}</span>
            {!implemented && (
              <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">
                {t("settings.comingSoon")}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
