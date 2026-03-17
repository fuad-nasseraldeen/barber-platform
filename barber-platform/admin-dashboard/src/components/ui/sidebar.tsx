"use client";

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
  UserCheck,
  Plane,
  Cake,
  DollarSign,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

interface SidebarProps {
  items: NavItem[];
  title: string;
  homeHref?: string;
}

const iconMap: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="h-4 w-4 shrink-0" />,
  appointments: <Calendar className="h-4 w-4 shrink-0" />,
  waitlist: <UsersRound className="h-4 w-4 shrink-0" />,
  customers: <Users className="h-4 w-4 shrink-0" />,
  staff: <UserCog className="h-4 w-4 shrink-0" />,
  services: <Scissors className="h-4 w-4 shrink-0" />,
  analytics: <BarChart3 className="h-4 w-4 shrink-0" />,
  automations: <Zap className="h-4 w-4 shrink-0" />,
  notifications: <Bell className="h-4 w-4 shrink-0" />,
  settings: <Settings className="h-4 w-4 shrink-0" />,
  "check-ins": <UserCheck className="h-4 w-4 shrink-0" />,
  vacation: <Plane className="h-4 w-4 shrink-0" />,
  team: <Users className="h-4 w-4 shrink-0" />,
  birthdays: <Cake className="h-4 w-4 shrink-0" />,
  earnings: <DollarSign className="h-4 w-4 shrink-0" />,
};

export function Sidebar({ items, title, homeHref = "/admin/dashboard" }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-60 flex-col border-e border-zinc-200/80 bg-white lg:flex dark:border-zinc-800/80 dark:bg-zinc-950">
      <div className="flex h-14 items-center border-b border-zinc-200/80 px-4 dark:border-zinc-800/80">
        <Link href={homeHref} className="flex items-center gap-2">
          <div className="sidebar-logo flex h-8 w-8 items-center justify-center rounded-lg">
            <span className="text-sm font-bold">B</span>
          </div>
          <span className="text-base font-semibold tracking-tight">{title}</span>
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const iconKey = item.href.split("/").pop() || "";
          const icon = item.icon ?? iconMap[iconKey];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-300 ease-in-out ${
                isActive
                  ? "bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:scale-[1.02] hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
              }`}
            >
              {icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
