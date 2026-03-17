"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  UsersRound,
  Users,
  UserCog,
  Scissors,
  BarChart3,
  Zap,
  Bell,
  Settings,
} from "lucide-react";
import { SidebarCollapseArrow } from "@/components/ui/nav-arrow";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5 shrink-0" /> },
  { href: "/admin/appointments", label: "Appointments", icon: <Calendar className="h-5 w-5 shrink-0" /> },
  { href: "/admin/waitlist", label: "Waitlist", icon: <UsersRound className="h-5 w-5 shrink-0" /> },
  { href: "/admin/customers", label: "Customers", icon: <Users className="h-5 w-5 shrink-0" /> },
  { href: "/admin/staff", label: "Staff", icon: <UserCog className="h-5 w-5 shrink-0" /> },
  { href: "/admin/services", label: "Services", icon: <Scissors className="h-5 w-5 shrink-0" /> },
  { href: "/admin/analytics", label: "Analytics", icon: <BarChart3 className="h-5 w-5 shrink-0" /> },
  { href: "/admin/automations", label: "Automations", icon: <Zap className="h-5 w-5 shrink-0" /> },
  { href: "/admin/notifications", label: "Notifications", icon: <Bell className="h-5 w-5 shrink-0" /> },
  { href: "/admin/settings", label: "Settings", icon: <Settings className="h-5 w-5 shrink-0" /> },
];

interface SidebarProps {
  items?: NavItem[];
  title?: string;
  homeHref?: string;
  onNavigate?: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { items = NAV_ITEMS, title = "תורן", homeHref = "/admin/dashboard", onNavigate } = props;
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={
        "hidden shrink-0 flex-col border-e border-zinc-200/80 bg-white shadow-md transition-all duration-300 ease-in-out lg:flex dark:border-zinc-800/80 dark:bg-zinc-950 " +
        (collapsed ? "w-[72px]" : "w-64")
      }
    >
      <div className="flex h-16 items-center justify-between border-b border-zinc-200/80 px-4 dark:border-zinc-800/80">
        {!collapsed && (
          <Link
            href={homeHref}
            onClick={onNavigate}
            className="flex items-center gap-2 transition-all duration-300 hover:scale-105"
          >
            <div className="sidebar-logo flex h-9 w-9 items-center justify-center rounded-xl shadow-lg">
              <span className="text-sm font-bold text-white">B</span>
            </div>
            <span className="text-base font-semibold tracking-tight">{title}</span>
          </Link>
        )}
        {collapsed && (
          <Link
            href={homeHref}
            onClick={onNavigate}
            className="sidebar-logo flex h-9 w-9 items-center justify-center rounded-xl shadow-lg transition-all duration-300 hover:scale-105"
          >
            <span className="text-sm font-bold text-white">B</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1.5 text-zinc-500 transition-all duration-300 hover:scale-105 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <SidebarCollapseArrow collapsed={collapsed} className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-in-out " +
                (isActive
                  ? "sidebar-active shadow-md"
                  : "text-zinc-600 hover:scale-[1.02] hover:bg-zinc-100 hover:text-zinc-900 hover:shadow-md dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50")
              }
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
