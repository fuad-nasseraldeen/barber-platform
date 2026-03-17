"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { UserPlus } from "lucide-react";
import toast from "react-hot-toast";
import type { Locale } from "@/stores/locale-store";

function getBodyFromSettings(
  nc?: { body?: string; locales?: Record<Locale, { body: string }> }
): string {
  if (!nc) return "";
  if (nc.locales) return nc.locales.he?.body ?? nc.locales.en?.body ?? nc.locales.ar?.body ?? "";
  return nc.body ?? "";
}

export default function NewCustomerMessagePage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        settings?: {
          newCustomerMessage?: {
            enabled: boolean;
            body?: string;
            locales?: Record<Locale, { body: string }>;
            healthDeclarationLink?: string;
            sendSms: boolean;
          };
        };
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const nc = business?.settings?.newCustomerMessage;
  const newCustomer = nc ?? {
    enabled: false,
    body: "",
    healthDeclarationLink: undefined,
    sendSms: false,
  };

  const [local, setLocal] = useState({
    ...newCustomer,
    body: getBodyFromSettings(nc),
  });
  useEffect(() => {
    const nc2 = business?.settings?.newCustomerMessage;
    setLocal((p) => ({
      ...(nc2 ?? p),
      body: getBodyFromSettings(nc2),
    }));
  }, [business?.settings?.newCustomerMessage]);

  const buildNewCustomerPayload = (updates: Partial<typeof local>) => {
    const merged = { ...newCustomer, ...local, ...updates };
    const locales = nc?.locales ?? { en: { body: "" }, he: { body: "" }, ar: { body: "" } };
    const updatedLocales = {
      ...locales,
      he: { body: merged.body ?? locales.he?.body ?? "" },
    };
    return {
      newCustomerMessage: {
        ...merged,
        locales: updatedLocales,
        body: updatedLocales.en?.body ?? updatedLocales.he?.body ?? updatedLocales.ar?.body ?? "",
      },
    };
  };

  const updateMutation = useMutation({
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
        <UserPlus className="h-6 w-6 text-rose-600" />
        {t("automations.sectionNewCustomer")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("automations.sectionNewCustomerDesc")}
      </p>
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={local.enabled}
            onChange={(e) => {
              setLocal((p) => ({ ...p, enabled: e.target.checked }));
              updateMutation.mutate(buildNewCustomerPayload({ enabled: e.target.checked }));
            }}
          />
          <span className="text-sm font-medium">{t("automations.sendNewCustomerMessage")}</span>
        </label>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("automations.messageTemplate")}</label>
          <textarea
            value={local.body}
            onChange={(e) => setLocal((p) => ({ ...p, body: e.target.value }))}
            rows={4}
            placeholder="נשארו תורים אחרונים לחג. היומן כמעט מלא. היכנסו עכשיו לאפליקציה"
            className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={local.healthDeclarationLink !== undefined}
            onChange={(e) => {
              setLocal((p) => ({
                ...p,
                healthDeclarationLink: e.target.checked ? (p.healthDeclarationLink ?? "") : undefined,
              }));
            }}
          />
          <span className="text-sm">{t("automations.sendHealthDeclarationLink")}</span>
        </label>
        {local.healthDeclarationLink !== undefined && (
          <div>
            <label className="mb-1 block text-sm font-medium">{t("automations.healthDeclarationUrl")}</label>
            <input
              type="url"
              value={local.healthDeclarationLink ?? ""}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  healthDeclarationLink: e.target.value || undefined,
                }))
              }
              placeholder="https://..."
              className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={local.sendSms}
            onChange={(e) => {
              setLocal((p) => ({ ...p, sendSms: e.target.checked }));
              updateMutation.mutate(buildNewCustomerPayload({ sendSms: e.target.checked }));
            }}
          />
          <span className="text-sm">{t("automations.sendViaSms")}</span>
        </label>
        <button
          type="button"
          onClick={() => updateMutation.mutate(buildNewCustomerPayload())}
          disabled={updateMutation.isPending}
          className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
        >
          {updateMutation.isPending ? t("widget.loading") : t("automations.save")}
        </button>
      </div>
    </div>
  );
}
