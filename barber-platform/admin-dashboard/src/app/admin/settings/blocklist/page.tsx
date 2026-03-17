"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Ban } from "lucide-react";
import toast from "react-hot-toast";

export default function BlocklistPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        settings?: { blockedPhones?: string[] };
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const phones = business?.settings?.blockedPhones ?? [];
  const [newPhone, setNewPhone] = useState("");

  const mutation = useMutation({
    mutationFn: (blockedPhones: string[]) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            ...business?.settings,
            blockedPhones,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business", businessId] });
      setNewPhone("");
      toast.success(t("widget.saved"));
    },
  });

  const add = () => {
    const normalized = newPhone.replace(/\D/g, "");
    if (normalized.length >= 9 && !phones.includes(normalized)) {
      mutation.mutate([...phones, normalized]);
    }
  };

  const remove = (p: string) => {
    mutation.mutate(phones.filter((x) => x !== p));
  };

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
        <Ban className="h-6 w-6 text-red-600" />
        {t("settings.customerBlocklist")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("settings.customerBlocklistDesc")}
      </p>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder={t("settings.blocklistPlaceholder")}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={add}
            disabled={mutation.isPending}
            className="btn-primary rounded-lg px-4 py-2 text-sm"
          >
            {t("settings.add")}
          </button>
        </div>
        <ul className="space-y-1">
          {phones.map((p) => (
            <li
              key={p}
              className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-600"
            >
              <span>{p}</span>
              <button
                type="button"
                onClick={() => remove(p)}
                className="text-red-600 hover:underline"
              >
                {t("settings.remove")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
