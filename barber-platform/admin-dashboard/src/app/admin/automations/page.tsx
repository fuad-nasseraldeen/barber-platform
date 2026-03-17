"use client";

import Link from "next/link";
import { useTranslation } from "@/hooks/use-translation";
import { FileCheck, Calendar, UserPlus } from "lucide-react";
import { ForwardArrow } from "@/components/ui/nav-arrow";

const SECTIONS = [
  {
    href: "/admin/automations/health-declaration",
    icon: FileCheck,
    iconColor: "text-emerald-600",
    key: "automations.sectionHealth",
    descKey: "automations.sectionHealthDesc",
  },
  {
    href: "/admin/automations/scheduled-messages",
    icon: Calendar,
    iconColor: "text-blue-600",
    key: "automations.sectionScheduled",
    descKey: "automations.sectionScheduledDesc",
  },
  {
    href: "/admin/automations/new-customer",
    icon: UserPlus,
    iconColor: "text-rose-600",
    key: "automations.sectionNewCustomer",
    descKey: "automations.sectionNewCustomerDesc",
  },
] as const;

export default function AdminAutomationsPage() {
  const t = useTranslation();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-semibold">{t("nav.automations")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("automations.subtitle")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, icon: Icon, iconColor, key, descKey }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-[var(--primary)] hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-[var(--primary)]"
          >
            <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-700 ${iconColor}`}>
              <Icon className="h-6 w-6" />
            </div>
            <h2 className="mb-1 font-semibold group-hover:text-[var(--primary)]">
              {t(key)}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t(descKey)}
            </p>
            <ForwardArrow className="mt-auto h-5 w-5 text-zinc-400 group-hover:text-[var(--primary)]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
