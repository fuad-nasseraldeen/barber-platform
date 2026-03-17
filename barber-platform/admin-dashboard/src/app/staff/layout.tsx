"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/ui/sidebar";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { BranchSelector } from "@/components/ui/branch-selector";
import { useAuthStore } from "@/stores/auth-store";
import Link from "next/link";

const staffNavItems = [
  { href: "/employee/dashboard", label: "Dashboard" },
  { href: "/employee/appointments", label: "Appointments" },
  { href: "/employee/services", label: "Services" },
];

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const businessId = useAuthStore((s) => s.user?.businessId);

  useEffect(() => {
    if (user?.role === "staff") {
      router.replace("/employee/dashboard");
    }
  }, [user?.role, router]);

  if (user?.role === "staff") {
    return null;
  }

  return (
    <div className="flex h-screen flex-row">
      <Sidebar items={staffNavItems} title="Staff" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Link href="/employee/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            Home
          </Link>
          <div className="flex items-center gap-4">
            {businessId && (
              <BranchSelector businessId={businessId} />
            )}
            <LocaleSwitcher />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
