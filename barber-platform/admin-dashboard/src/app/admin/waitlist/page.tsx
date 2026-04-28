"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock3, Mail, Phone, Sparkles, UserRound } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useEffectiveBranchId } from "@/hooks/use-effective-branch-id";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";

type WaitlistEntry = {
  id: string;
  priority?: number | null;
  notes?: string | null;
  createdAt?: string | null;
  preferredDateStart?: string | null;
  preferredDateEnd?: string | null;
  preferredTimeStart?: string | null;
  preferredTimeEnd?: string | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  service?: {
    name?: string | null;
  } | null;
  staff?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

function fullName(firstName?: string | null, lastName?: string | null): string {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name || "Unknown";
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export default function AdminWaitlistPage() {
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const dir = useLocaleStore((s) => s.dir);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const branchId = useEffectiveBranchId(businessId);

  const { data, isLoading } = useQuery({
    queryKey: ["waitlist", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<WaitlistEntry[]>(
        `/waitlist?businessId=${businessId}&status=ACTIVE${branchId ? `&branchId=${branchId}` : ""}&limit=50`
      ),
    enabled: !!businessId,
  });

  const items = Array.isArray(data) ? data : [];

  if (!businessId) {
    return (
      <div className="px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.waitlist")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("waitlist.loginRequired")}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <main dir={dir} className="mx-auto w-full max-w-4xl px-4 pt-4 pb-7 sm:px-5 sm:pt-5">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">{t("nav.waitlist")}</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-[190px] animate-pulse rounded-3xl border border-zinc-200 bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/70"
            />
          ))}
        </div>
      </main>
    );
  }

  const withPhone = items.filter((i) => !!i.customer?.phone).length;
  const topPriority = items.reduce((max, item) => Math.max(max, item.priority ?? 0), 0);

  return (
    <main dir={dir} className="mx-auto w-full max-w-4xl px-4 pt-4 pb-7 sm:px-5 sm:pt-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("nav.waitlist")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("waitlist.activeEntries")}: {items.length}
        </p>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{t("waitlist.total")}</p>
          <p className="mt-1 text-xl font-semibold">{items.length}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{t("waitlist.withPhone")}</p>
          <p className="mt-1 text-xl font-semibold">{withPhone}</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-800 dark:bg-zinc-900/70 col-span-2 sm:col-span-1">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{t("waitlist.topPriority")}</p>
          <p className="mt-1 text-xl font-semibold">{topPriority}</p>
        </div>
      </section>

      {items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item, index) => {
            const customerName = fullName(
              item.customer?.firstName,
              item.customer?.lastName,
            );
            const staffName = fullName(item.staff?.firstName, item.staff?.lastName);

            return (
              <article
                key={item.id}
                className="waitlist-card-enter rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-white to-zinc-50 p-4 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.35)] dark:border-zinc-800 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-950"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {customerName}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {item.service?.name || t("appointments.service")}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {t("waitlist.priority")} {item.priority ?? 0}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span>{item.customer?.phone || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span className="truncate">{item.customer?.email || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span>{t("waitlist.preferredStaff")}: {staffName === "Unknown" ? "—" : staffName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span>
                      {formatDate(item.preferredDateStart, locale)}
                      {" → "}
                      {formatDate(item.preferredDateEnd, locale)}
                      {" · "}
                      {item.preferredTimeStart || "00:00"}-{item.preferredTimeEnd || "23:59"}
                    </span>
                  </div>
                </div>

                {item.notes ? (
                  <p className="mt-3 rounded-2xl bg-zinc-100/75 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300">
                    {item.notes}
                  </p>
                ) : null}

                <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t("waitlist.createdAt")}: {formatDateTime(item.createdAt, locale)}
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="waitlist-empty-float rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-8 text-center shadow-[0_10px_34px_-24px_rgba(0,0,0,0.45)] dark:border-zinc-800 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-950">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("waitlist.emptyTitle")}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("waitlist.emptyBody")}</p>
        </div>
      )}
    </main>
  );
}
