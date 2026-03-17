"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { useLocaleStore } from "@/stores/locale-store";
import { Cake } from "lucide-react";

type StaffMember = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
};

export default function EmployeeBirthdaysPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const businessId = useAuthStore((s) => s.user?.businessId);

  const { data: staffList, isLoading, error } = useQuery<StaffMember[]>({
    queryKey: ["staff", "list", businessId],
    queryFn: () => apiClient(`/staff?businessId=${businessId}&limit=100`),
    enabled: !!businessId,
    retry: false,
  });

  const list = Array.isArray(staffList) ? staffList : [];
  const withBirthdays = list.filter((s) => s.birthDate);
  const today = new Date();
  const thisMonth = today.getMonth();
  const thisDay = today.getDate();

  const upcoming = withBirthdays
    .map((s) => {
      const bd = new Date(s.birthDate!);
      const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
      if (next < today) next.setFullYear(next.getFullYear() + 1);
      return { ...s, nextDate: next };
    })
    .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime())
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("employee.birthdays")}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {t("employee.birthdaysSubtitle")}
      </p>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-amber-800 dark:text-amber-200">
            {t("employee.birthdaysManagerOnly")}
          </p>
        </div>
      ) : upcoming.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-12 dark:border-zinc-600">
          <Cake className="mb-4 h-12 w-12 text-zinc-400" />
          <p className="text-zinc-500">{t("employee.noBirthdaysOnFile")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <p className="font-semibold">
                {s.firstName} {s.lastName}
              </p>
              <p className="text-sm text-zinc-500" suppressHydrationWarning>
                {s.nextDate.toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                })}
                {s.nextDate.getMonth() === thisMonth && s.nextDate.getDate() === thisDay && (
                  <span className="ml-2 text-amber-600">{t("employee.birthdayToday")}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
