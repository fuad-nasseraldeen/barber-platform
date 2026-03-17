"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { FileCheck } from "lucide-react";
import toast from "react-hot-toast";

export default function HealthDeclarationPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        settings?: {
          healthDeclaration?: {
            afterBooking?: boolean;
            inNewCustomerMessage?: boolean;
            inPrivateMessage?: boolean;
          };
        };
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const hd = business?.settings?.healthDeclaration ?? {};

  const updateSettingsMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            ...business?.settings,
            ...updates,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business", businessId] });
      toast.success(t("widget.saved"));
    },
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
        <FileCheck className="h-6 w-6 text-emerald-600" />
        {t("automations.sectionHealth")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("automations.sectionHealthDesc")}
      </p>
      <div className="space-y-4">
        {[
          { key: "afterBooking", i18n: "automations.hdAfterBooking" },
          { key: "inNewCustomerMessage", i18n: "automations.hdInNewCustomerMessage" },
          { key: "inPrivateMessage", i18n: "automations.hdInPrivateMessage" },
        ].map(({ key, i18n }) => (
          <label key={key} className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={hd[key as keyof typeof hd] ?? false}
              onChange={(e) =>
                updateSettingsMutation.mutate({
                  healthDeclaration: { ...hd, [key]: e.target.checked },
                })
              }
              disabled={updateSettingsMutation.isPending}
            />
            <span className="text-sm">{t(i18n)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
