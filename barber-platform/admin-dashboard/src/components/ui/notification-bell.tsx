"use client";

import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/stores/notification-store";
import { useTranslation } from "@/hooks/use-translation";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, markAsRead, markAllAsRead } = useNotificationStore();
  const t = useTranslation();

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-zinc-600 transition-all duration-300 ease-in-out hover:scale-105 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        aria-label={t("topbar.notifications")}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute end-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl transition-all duration-300 ease-in-out dark:border-zinc-700 dark:bg-zinc-900"
          role="dialog"
          aria-label={t("topbar.notifications")}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <h3 className="font-semibold">{t("topbar.notifications")}</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
              >
                {t("topbar.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">
                {t("topbar.noNotifications")}
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {notifications.slice(0, 20).map((n) => (
                  <li
                    key={n.id}
                    onClick={() => markAsRead(n.id)}
                    className={`cursor-pointer px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                      !n.read ? "bg-zinc-50/50 dark:bg-zinc-800/30" : ""
                    }`}
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
