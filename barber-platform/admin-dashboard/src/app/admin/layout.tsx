"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
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
  Plane,
  UserCheck,
  Coffee,
} from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SidebarDrawer } from "@/components/dashboard/sidebar-drawer";
import { TopBar } from "@/components/dashboard/topbar";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { AdminMobileBottomNav } from "@/components/dashboard/mobile-bottom-nav";
import { PageTransition } from "@/components/ui/page-transition";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import type { NavItem } from "@/components/dashboard/sidebar";
import {
  canAccessAdmin,
  canAccessPage,
  getAllowedPages,
} from "@/lib/admin-permissions";

const adminNavKeys = [
  { href: "/admin/dashboard", key: "nav.dashboard" },
  { href: "/admin/appointments", key: "nav.appointments" },
  { href: "/admin/waitlist", key: "nav.waitlist" },
  { href: "/admin/customers", key: "nav.customers" },
  { href: "/admin/arrival-confirmations", key: "nav.arrivalConfirmations" },
  { href: "/admin/staff", key: "nav.staff" },
  { href: "/admin/breaks", key: "breaks.title" },
  { href: "/admin/vacations", key: "nav.vacations" },
  { href: "/admin/services", key: "nav.services" },
  { href: "/admin/analytics", key: "nav.analytics" },
  { href: "/admin/automations", key: "nav.automations" },
  { href: "/admin/notifications", key: "nav.notifications" },
  { href: "/admin/settings", key: "nav.settings" },
];

const iconMap: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="h-5 w-5 shrink-0" />,
  appointments: <Calendar className="h-5 w-5 shrink-0" />,
  waitlist: <UsersRound className="h-5 w-5 shrink-0" />,
  customers: <Users className="h-5 w-5 shrink-0" />,
  "arrival-confirmations": <UserCheck className="h-5 w-5 shrink-0" />,
  staff: <UserCog className="h-5 w-5 shrink-0" />,
  breaks: <Coffee className="h-5 w-5 shrink-0" />,
  vacations: <Plane className="h-5 w-5 shrink-0" />,
  services: <Scissors className="h-5 w-5 shrink-0" />,
  analytics: <BarChart3 className="h-5 w-5 shrink-0" />,
  automations: <Zap className="h-5 w-5 shrink-0" />,
  notifications: <Bell className="h-5 w-5 shrink-0" />,
  settings: <Settings className="h-5 w-5 shrink-0" />,
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const pathname = usePathname();
  const role = user?.role;

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!businessId) {
      router.replace("/setup");
      return;
    }
    if (role === "staff") {
      router.replace("/employee/dashboard");
      return;
    }
    if (!canAccessAdmin(role)) {
      router.replace("/");
      return;
    }
  }, [user, businessId, role, router]);

  useEffect(() => {
    if (!user || !businessId || !canAccessAdmin(role)) return;
    if (!canAccessPage(pathname, role)) {
      const allowed = getAllowedPages(role);
      router.replace(allowed[0] ?? "/admin/dashboard");
    }
  }, [pathname, role, user, businessId, router]);

  useEffect(() => {
    const handler = () => setCommandOpen(true);
    window.addEventListener("open-command-palette", handler);
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  const allowedPaths = getAllowedPages(role);
  const adminNavItems: NavItem[] = adminNavKeys
    .filter(({ href }) => allowedPaths.includes(href))
    .map(({ href, key }) => ({
      href,
      label: t(key),
      icon: iconMap[href.split("/").pop() || ""] ?? <LayoutDashboard className="h-5 w-5 shrink-0" />,
    }));

  if (!user || !businessId || !canAccessAdmin(role)) {
    return null;
  }

  if (!canAccessPage(pathname, role)) {
    return null;
  }

  return (
    <div className="flex h-screen flex-row bg-zinc-50 dark:bg-zinc-950">
      <Sidebar items={adminNavItems} title="תורן" />
      <SidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={adminNavItems}
        title="תורן"
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          onSearchClick={() => setCommandOpen(true)}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-auto bg-zinc-50 p-4 pb-12 md:p-6 lg:pb-6 dark:bg-zinc-950">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <AdminMobileBottomNav />
    </div>
  );
}
