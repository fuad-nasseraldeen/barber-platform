"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Bell,
  UserCheck,
  Plane,
  Scissors,
  Users,
  Cake,
  DollarSign,
  UserCircle,
} from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SidebarDrawer } from "@/components/dashboard/sidebar-drawer";
import { TopBar } from "@/components/dashboard/topbar";
import { EmployeeMobileBottomNav } from "@/components/dashboard/mobile-bottom-nav";
import { PageTransition } from "@/components/ui/page-transition";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import type { NavItem } from "@/components/dashboard/sidebar";

export default function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const employeeNavItems: NavItem[] = useMemo(
    () => [
      { href: "/employee/dashboard", label: t("employee.dashboard"), icon: <LayoutDashboard className="h-5 w-5 shrink-0" /> },
      { href: "/employee/appointments", label: t("nav.appointments"), icon: <Calendar className="h-5 w-5 shrink-0" /> },
      { href: "/employee/notifications", label: t("employee.notifications"), icon: <Bell className="h-5 w-5 shrink-0" /> },
      { href: "/employee/check-ins", label: t("employee.checkIns"), icon: <UserCheck className="h-5 w-5 shrink-0" /> },
      { href: "/employee/vacations", label: t("employee.vacation"), icon: <Plane className="h-5 w-5 shrink-0" /> },
      { href: "/employee/services", label: t("nav.services"), icon: <Scissors className="h-5 w-5 shrink-0" /> },
      { href: "/employee/team", label: t("employee.team"), icon: <Users className="h-5 w-5 shrink-0" /> },
      { href: "/employee/birthdays", label: t("employee.birthdays"), icon: <Cake className="h-5 w-5 shrink-0" /> },
      { href: "/employee/earnings", label: t("employee.earnings"), icon: <DollarSign className="h-5 w-5 shrink-0" /> },
      { href: "/employee/profile", label: t("topbar.profile"), icon: <UserCircle className="h-5 w-5 shrink-0" /> },
    ],
    [t]
  );

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "staff") {
      router.replace("/admin/dashboard");
      return;
    }
    if (!businessId) {
      router.replace("/setup");
      return;
    }
  }, [user, businessId, router]);

  if (!user || !businessId || user.role !== "staff") {
    return null;
  }

  return (
    <div className="flex h-screen flex-row bg-zinc-50 dark:bg-zinc-950">
      <Sidebar
        items={employeeNavItems}
        title={t("employee.title")}
        homeHref="/employee/dashboard"
        onNavigate={() => {}}
      />
      <SidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={employeeNavItems}
        title={t("employee.title")}
        homeHref="/employee/dashboard"
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          onSearchClick={() => {}}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-auto bg-zinc-50 p-4 pb-24 md:p-6 lg:pb-6 dark:bg-zinc-950">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <EmployeeMobileBottomNav />
    </div>
  );
}
