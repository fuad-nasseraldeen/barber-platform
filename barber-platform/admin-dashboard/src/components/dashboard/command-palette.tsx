"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
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
  UserPlus,
  UserCheck,
  Coffee,
} from "lucide-react";
import { ForwardArrow } from "@/components/ui/nav-arrow";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { getAllowedPages } from "@/lib/admin-permissions";

type ActionType = "navigate" | "customer" | "staff" | "create-appointment";

interface Action {
  type: ActionType;
  label: string;
  href?: string;
  icon: React.ReactNode;
  id?: string;
  subtitle?: string;
}

const NAV_ACTIONS: Action[] = [
  { type: "navigate", label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { type: "navigate", label: "Appointments", href: "/admin/appointments", icon: <Calendar className="h-4 w-4" /> },
  { type: "navigate", label: "Waitlist", href: "/admin/waitlist", icon: <UsersRound className="h-4 w-4" /> },
  { type: "navigate", label: "Customers", href: "/admin/customers", icon: <Users className="h-4 w-4" /> },
  { type: "navigate", label: "Arrival confirmations", href: "/admin/arrival-confirmations", icon: <UserCheck className="h-4 w-4" /> },
  { type: "navigate", label: "Staff", href: "/admin/staff", icon: <UserCog className="h-4 w-4" /> },
  { type: "navigate", label: "Breaks", href: "/admin/breaks", icon: <Coffee className="h-4 w-4" /> },
  { type: "navigate", label: "Services", href: "/admin/services", icon: <Scissors className="h-4 w-4" /> },
  { type: "navigate", label: "Analytics", href: "/admin/analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { type: "navigate", label: "Automations", href: "/admin/automations", icon: <Zap className="h-4 w-4" /> },
  { type: "navigate", label: "Notifications", href: "/admin/notifications", icon: <Bell className="h-4 w-4" /> },
  { type: "navigate", label: "Settings", href: "/admin/settings", icon: <Settings className="h-4 w-4" /> },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const role = useAuthStore((s) => s.user?.role);
  const allowedPaths = getAllowedPages(role);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: customers = [] } = useQuery({
    queryKey: ["command-customers", businessId, query],
    queryFn: () =>
      apiClient<{ id: string; firstName?: string; lastName?: string; email: string }[]>(
        `/customers?businessId=${businessId}&search=${encodeURIComponent(query)}`
      ).then((list) => list.slice(0, 5)),
    enabled: open && !!businessId && query.length >= 2,
  });

  const canAccessStaff = allowedPaths.includes("/admin/staff");
  const { data: staff = [] } = useQuery({
    queryKey: ["command-staff", businessId, query],
    queryFn: () =>
      apiClient<{ id: string; firstName: string; lastName: string }[]>(
        `/staff?businessId=${businessId}&includeInactive=true`
      ).then((list) =>
        list.filter(
          (s) =>
            query.length < 2 ||
            `${s.firstName} ${s.lastName}`.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 5)
      ),
    enabled: open && !!businessId && query.length >= 2 && canAccessStaff,
  });

  const createAction: Action = {
    type: "create-appointment",
    label: "Create appointment",
    href: "/admin/appointments",
    icon: <UserPlus className="h-4 w-4" />,
  };

  const navFiltered = NAV_ACTIONS.filter(
    (a) =>
      a.href && allowedPaths.includes(a.href) &&
      (!query || a.label.toLowerCase().includes(query.toLowerCase()))
  );

  const customerActions: Action[] = customers.map((c) => ({
    type: "customer" as const,
    label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email,
    id: c.id,
    href: `/admin/customers/${c.id}`,
    icon: <Users className="h-4 w-4" />,
    subtitle: c.email,
  }));

  const staffActions: Action[] = canAccessStaff
    ? staff.map((s) => ({
        type: "staff" as const,
        label: `${s.firstName} ${s.lastName}`,
        id: s.id,
        href: `/admin/staff`,
        icon: <UserCog className="h-4 w-4" />,
      }))
    : [];

  const canCreateAppointment = allowedPaths.includes("/admin/appointments");
  const showCreate =
    canCreateAppointment &&
    (!query || "create appointment".includes(query.toLowerCase()));
  const allActions: Action[] = [
    ...(showCreate ? [createAction] : []),
    ...customerActions,
    ...staffActions,
    ...navFiltered,
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allActions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const action = allActions[selectedIndex];
        if (action?.href) {
          router.push(action.href);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, selectedIndex, allActions, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) onClose();
        else {
          const event = new CustomEvent("open-command-palette");
          window.dispatchEvent(event);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 min-h-[100dvh] bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed start-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-700">
          <Search className="h-5 w-5 shrink-0 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers, staff, or navigate..."
            className="flex-1 bg-transparent py-4 text-base outline-none placeholder:text-zinc-400"
            autoFocus
          />
          <kbd className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-400 dark:border-zinc-600">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {allActions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No results
            </div>
          ) : (
            <ul className="py-1">
              {allActions.map((action, i) => (
                <li key={action.href + (action.id ?? "") + i}>
                  <button
                    type="button"
                    onClick={() => {
                      if (action.href) {
                        router.push(action.href);
                        onClose();
                      }
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-all duration-200 ${
                      i === selectedIndex
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                        : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      {action.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{action.label}</p>
                      {action.subtitle && (
                        <p className="truncate text-xs text-zinc-500">{action.subtitle}</p>
                      )}
                    </div>
                    <ForwardArrow className="h-4 w-4 shrink-0 text-zinc-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
