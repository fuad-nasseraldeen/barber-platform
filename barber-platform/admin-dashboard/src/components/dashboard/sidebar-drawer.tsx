"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { NavItem } from "./sidebar";
import { NAV_ITEMS } from "./sidebar";

interface SidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  items?: NavItem[];
  title?: string;
  homeHref?: string;
}

export function SidebarDrawer({
  open,
  onClose,
  items = NAV_ITEMS,
  title = "תורן",
  homeHref = "/admin/dashboard",
}: SidebarDrawerProps) {
  const pathname = usePathname();

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
        className="fixed inset-y-0 start-0 z-50 w-64 overflow-hidden bg-white shadow-xl transition-all duration-300 ease-in-out dark:bg-zinc-950 lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex h-16 items-center justify-between border-b border-zinc-200/80 px-4 dark:border-zinc-800/80">
          <Link
            href={homeHref}
            onClick={onClose}
            className="flex items-center gap-2"
          >
            <div className="sidebar-logo flex h-9 w-9 items-center justify-center rounded-xl shadow-lg">
              <span className="text-sm font-bold text-white">B</span>
            </div>
            <span className="font-semibold">{title}</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2.5 text-zinc-500 transition-all duration-300 hover:scale-105 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-in-out ${
                  isActive
                    ? "sidebar-active shadow-md"
                    : "text-zinc-600 hover:scale-[1.02] hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
