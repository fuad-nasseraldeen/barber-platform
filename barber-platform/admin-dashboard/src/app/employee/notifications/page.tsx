"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import { Bell } from "lucide-react";

function getNotificationDisplay(
  n: { type: string; title: string; body?: string | null; data?: unknown },
  t: (k: string) => string
) {
  if (n.type === "vacation_requested") {
    const data = n.data as Record<string, unknown> | null | undefined;
    let staffName = (data?.staffName as string) ?? "";
    if (!staffName && n.body) {
      const match = n.body.match(/^(.+?)\s+requested\s+time\s+off/i);
      if (match) staffName = match[1].trim();
    }
    if (staffName) {
      return {
        title: t("notification.vacationRequestedTitle"),
        body: t("notification.vacationRequestedBody").replace(/\{name\}/g, staffName),
      };
    }
    return {
      title: t("notification.vacationRequestedTitle"),
      body: t("notification.vacationRequestedBody").replace(/\{name\}/g, t("vacation.me")),
    };
  }
  return { title: n.title, body: n.body ?? "" };
}

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  readAt: string | null;
  createdAt: string;
};

export default function EmployeeNotificationsPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications", businessId],
    queryFn: () =>
      apiClient(`/notifications?businessId=${businessId}&limit=50`),
    enabled: !!businessId,
  });

  const list = notifications ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("employee.notifications")}</h1>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-12 dark:border-zinc-600">
          <Bell className="mb-4 h-12 w-12 text-zinc-400" />
          <p className="text-zinc-500">{t("employee.noNotifications")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((n) => {
            const { title, body } = getNotificationDisplay(n, t);
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-4 ${
                  n.readAt
                    ? "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
                    : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/20"
                }`}
              >
                <p className="font-medium">{title}</p>
                {body && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>}
                <p className="mt-2 text-xs text-zinc-500" suppressHydrationWarning>
                  {new Date(n.createdAt).toLocaleString(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
