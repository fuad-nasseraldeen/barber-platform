"use client";

import Link from "next/link";
import { Menu, Search } from "lucide-react";
import { BranchSelector } from "@/components/ui/branch-selector";
import { Notifications } from "./notifications";
import { ThemeSwitcher } from "./theme-switcher";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { UserProfileMenu } from "@/components/ui/user-profile-menu";
import { useTranslation } from "@/hooks/use-translation";
import { useAuthStore } from "@/stores/auth-store";

interface TopBarProps {
  onMenuClick?: () => void;
  onSearchClick?: () => void;
}

export function TopBar({ onMenuClick, onSearchClick }: TopBarProps) {
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId;
  const homeHref = user?.role === "staff" ? "/employee/dashboard" : user ? "/admin/dashboard" : "/";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-zinc-200/80 bg-white px-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-950">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-xl p-2.5 text-zinc-600 transition-all duration-300 hover:scale-105 hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onSearchClick}
          className="hidden w-full max-w-md items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-500 transition-all duration-300 hover:border-zinc-300 hover:bg-zinc-100 md:flex dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>{t("topbar.searchPlaceholder")}</span>
          <kbd className="ms-auto hidden rounded border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-600 sm:inline-block">
            ⌘K
          </kbd>
        </button>
        <Link
          href={homeHref}
          className="shrink-0 text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-400"
        >
          {t("nav.home")}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {businessId && (
          <div className="hidden sm:block">
            <BranchSelector businessId={businessId} />
          </div>
        )}
        <Notifications />
        <ThemeSwitcher />
        <LocaleSwitcher />
        <UserProfileMenu />
      </div>
    </header>
  );
}
