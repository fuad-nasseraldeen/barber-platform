"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, LayoutDashboard, Calendar, UsersRound, Users, UserCog, Scissors, BarChart3, Zap, Bell, Settings } from "lucide-react";
import type { NavItem } from "./sidebar";

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
};

interface SidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  title: string;
}

export function SidebarDrawer({
  open,
  onClose,
  items,
  title,
}: SidebarDrawerProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 min-h-[100dvh] bg-black/70 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-y-0 start-0 z-50 w-60 bg-white shadow-xl dark:bg-zinc-950 lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex h-14 items-center justify-between border-b border-zinc-200/80 px-4 dark:border-zinc-800/80">
          <span className="font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-[calc(100vh-3.5rem)] overflow-auto">
          <SidebarContent items={items} onNavigate={onClose} iconMap={iconMap} />
        </div>
      </div>
    </>
  );
}

function SidebarContent({
  items,
  onNavigate,
  iconMap,
}: {
  items: NavItem[];
  onNavigate: () => void;
  iconMap: Record<string, React.ReactNode>;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.map((item) => {
        const iconKey = item.href.split("/").pop() || "";
        const icon = item.icon ?? iconMap[iconKey];
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
              isActive
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
