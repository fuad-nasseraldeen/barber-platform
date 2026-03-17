"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { MessageSquare } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import toast from "react-hot-toast";

const PLACEHOLDERS = [
  { key: "customerName", placeholder: "{{customerName}}", i18n: "settings.phCustomerName" },
  { key: "staffName", placeholder: "{{staffName}}", i18n: "settings.phStaffName" },
  { key: "startTime", placeholder: "{{startTime}}", i18n: "settings.phStartTime" },
  { key: "branchName", placeholder: "{{branchName}}", i18n: "settings.phBranchName" },
  { key: "serviceName", placeholder: "{{serviceName}}", i18n: "settings.phServiceName" },
  { key: "todayOrTomorrow", placeholder: "{{todayOrTomorrow}}", i18n: "settings.phTodayOrTomorrow" },
  { key: "dayName", placeholder: "{{dayName}}", i18n: "settings.phDayName" },
  { key: "businessName", placeholder: "{{businessName}}", i18n: "settings.phBusinessName" },
  { key: "canMf", placeholder: "{{canMf}}", i18n: "settings.phCanMf" },
  { key: "youMf", placeholder: "{{youMf}}", i18n: "settings.phYouMf" },
  { key: "arrivingMf", placeholder: "{{arrivingMf}}", i18n: "settings.phArrivingMf" },
  { key: "address", placeholder: "{{address}}", i18n: "settings.phAddress" },
] as const;

export default function ArrivalConfirmationPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{
        settings?: { arrivalConfirmation?: { template: string } };
      }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const defaultTemplate = t("settings.arrivalConfirmationDefault");
  const template = business?.settings?.arrivalConfirmation?.template ?? defaultTemplate;
  const [local, setLocal] = useState(template);

  useEffect(() => {
    setLocal(template);
  }, [template]);

  const mutation = useMutation({
    mutationFn: (text: string) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            ...business?.settings,
            arrivalConfirmation: { template: text },
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business", businessId] });
      toast.success(t("widget.saved"));
    },
  });

  const insertPlaceholder = (placeholder: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = local.slice(0, start);
      const after = local.slice(end);
      const next = before + placeholder + after;
      setLocal(next);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      setLocal((prev) => prev + placeholder);
    }
  };

  const previewName = t("settings.previewName");
  const previewText = local
    .replace(/\{\{customerName\}\}/g, previewName)
    .replace(/\{\{staffName\}\}/g, "יוסי")
    .replace(/\{\{startTime\}\}/g, "10:00")
    .replace(/\{\{branchName\}\}/g, "סניף מרכז")
    .replace(/\{\{serviceName\}\}/g, "תספורת")
    .replace(/\{\{todayOrTomorrow\}\}/g, "היום")
    .replace(/\{\{dayName\}\}/g, "רביעי")
    .replace(/\{\{businessName\}\}/g, "מספרת")
    .replace(/\{\{canMf\}\}/g, "יכול")
    .replace(/\{\{youMf\}\}/g, "אתה")
    .replace(/\{\{arrivingMf\}\}/g, "מגיע")
    .replace(/\{\{address\}\}/g, "רחוב הרצל 1");

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
        <MessageSquare className="h-6 w-6 text-amber-600" />
        {t("settings.arrivalConfirmation")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("settings.arrivalConfirmationDesc")}
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">
            {t("settings.arrivalConfirmation")}
          </label>
          <textarea
            ref={textareaRef}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            placeholder="שים לב {{customerName}} במידה ולא תגיע..."
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("settings.arrivalPlaceholdersTitle")}
          </p>
          <div className="flex flex-wrap gap-2">
            {PLACEHOLDERS.map(({ placeholder, i18n }) => (
              <button
                key={placeholder}
                type="button"
                onClick={() => insertPlaceholder(placeholder)}
                className="rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-1.5 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 dark:border-[var(--primary)]/50 dark:bg-[var(--primary)]/15 dark:hover:bg-[var(--primary)]/25"
              >
                {t(i18n)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("settings.arrivalConfirmationPreview")}:
          </p>
          <div className="flex max-w-sm justify-start rtl:justify-end">
            <div className="relative max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 shadow-sm rtl:rounded-bl-2xl rtl:rounded-br-md dark:bg-zinc-700/80">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">
                {previewText}
              </p>
              <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                {new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <LoadingButton
            loading={mutation.isPending}
            onClick={() => mutation.mutate(local)}
          >
            {t("settings.save")}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
