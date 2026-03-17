"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, User } from "lucide-react";
import { DropdownArrow } from "@/components/ui/nav-arrow";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { apiClient } from "@/lib/api-client";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import Link from "next/link";

export function UserProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const t = useTranslation();

  const { data: profileStaff } = useQuery<{
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
  }>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    retry: false,
    enabled: !!(user?.staffId || user?.businessId),
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = profileStaff?.firstName
    || (user?.name ? user.name.split(/\s+/)[0] : null)
    || user?.email
    || user?.phone
    || "User";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <StaffAvatar
          avatarUrl={profileStaff?.avatarUrl ?? null}
          firstName={profileStaff?.firstName ?? ""}
          lastName={profileStaff?.lastName ?? ""}
          size="sm"
          fallbackIcon={<User className="h-4 w-4" />}
        />
        <span className="hidden max-w-32 truncate sm:block">{displayName}</span>
        <DropdownArrow
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {user?.email && (
              <p className="truncate text-xs text-zinc-500">{user.email}</p>
            )}
            {user?.role && (
              <p className="mt-0.5 truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {t(`role.${user.role}`)}
              </p>
            )}
          </div>
          <div className="py-1">
            <Link
              href="/admin/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <User className="h-4 w-4" />
              {t("topbar.profile")}
            </Link>
            <button
              type="button"
              onClick={() => {
                logout();
                setOpen(false);
                window.location.href = "/";
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <LogOut className="h-4 w-4" />
              {t("topbar.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
