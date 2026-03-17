"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Coffee,
  Bell,
  Settings,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

const EMPLOYEE_NAV = [
  { href: "/employee/dashboard", icon: LayoutDashboard, labelKey: "nav.home" },
  { href: "/employee/appointments", icon: Calendar, labelKey: "nav.calendar" },
  { href: "/employee/breaks", icon: Coffee, labelKey: "breaks.title" },
  { href: "/employee/notifications", icon: Bell, labelKey: "nav.notifications" },
  { href: "/employee/profile", icon: Settings, labelKey: "topbar.profile" },
];

const ADMIN_NAV = [
  { href: "/admin/dashboard", icon: LayoutDashboard, labelKey: "nav.home" },
  { href: "/admin/appointments", icon: Calendar, labelKey: "nav.calendar" },
  { href: "/admin/breaks", icon: Coffee, labelKey: "breaks.title" },
  { href: "/admin/notifications", icon: Bell, labelKey: "nav.notifications" },
  { href: "/admin/settings", icon: Settings, labelKey: "mobile.more" },
];

export function EmployeeMobileBottomNav() {
  const pathname = usePathname();
  const t = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-zinc-200 bg-white/95 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/95 lg:hidden">
      {EMPLOYEE_NAV.map(({ href, icon: Icon, labelKey }) => {
        const isActive = pathname === href || (href !== "/employee/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 text-xs ${
              isActive
                ? "text-primary font-medium"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminMobileBottomNav() {
  const pathname = usePathname();
  const t = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-zinc-200 bg-white/95 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/95 lg:hidden">
      {ADMIN_NAV.map(({ href, icon: Icon, labelKey }) => {
        const isActive =
          pathname === href ||
          (href !== "/admin/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 text-xs ${
              isActive
                ? "text-primary font-medium"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
