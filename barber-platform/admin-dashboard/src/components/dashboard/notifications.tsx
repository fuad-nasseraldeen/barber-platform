"use client";

import { useState, useRef, useEffect } from "react";
import { Bell, Calendar, Plane, UserPlus, Users } from "lucide-react";
import { useNotificationStore } from "@/stores/notification-store";
import { useLocaleStore } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";
import Link from "next/link";

function getNotificationDisplay(n: { type: string; title: string; body?: string; data?: Record<string, unknown> }, t: (k: string) => string) {
  if (n.type === "vacation_requested") {
    let staffName = (n.data?.staffName as string) ?? "";
    if (!staffName && n.body) {
      const match = n.body.match(/^(.+?)\s+requested\s+time\s+off/i);
      if (match) staffName = match[1].trim();
    }
    if (!staffName) staffName = t("vacation.me");
    return {
      title: t("notification.vacationRequestedTitle"),
      body: t("notification.vacationRequestedBody").replace(/\{name\}/g, staffName),
    };
  }
  return { title: n.title, body: n.body };
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  appointment_booked: <Calendar className="h-4 w-4 text-emerald-500" />,
  appointment_cancelled: <Calendar className="h-4 w-4 text-amber-500" />,
  appointment_no_show: <Calendar className="h-4 w-4 text-red-500" />,
  customer_registered: <UserPlus className="h-4 w-4 text-blue-500" />,
  customer_joined: <UserPlus className="h-4 w-4 text-blue-500" />,
  waitlist_notification: <Users className="h-4 w-4 text-indigo-500" />,
  waitlist_joined: <Users className="h-4 w-4 text-indigo-500" />,
  waitlist_opened: <Users className="h-4 w-4 text-indigo-500" />,
  vacation_requested: <Plane className="h-4 w-4 text-amber-500" />,
  automation: <Bell className="h-4 w-4 text-zinc-500" />,
};

export function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, markAsRead, markAllAsRead } = useNotificationStore();
  const t = useTranslation();
  const locale = useLocaleStore((s) => s.locale);

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
        className="relative rounded-xl p-2.5 text-zinc-600 transition-all duration-300 ease-in-out hover:scale-105 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        aria-label={t("topbar.notifications")}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white shadow-lg">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute start-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl transition-all duration-300 ease-in-out sm:start-auto sm:end-0 sm:max-w-none dark:border-zinc-700 dark:bg-zinc-900"
          role="dialog"
          aria-label={t("topbar.notifications")}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <h3 className="font-semibold">{t("topbar.notifications")}</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-all duration-300 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
              >
                {t("topbar.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-zinc-500">
                {t("topbar.noNotifications")}
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {notifications.slice(0, 20).map((n) => {
                  const { title, body } = getNotificationDisplay(n, t);
                  return (
                    <li
                      key={n.id}
                      onClick={() => markAsRead(n.id)}
                      className={`flex gap-3 px-4 py-3 transition-all duration-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                        !n.read ? "bg-zinc-50/80 dark:bg-zinc-800/30" : ""
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {TYPE_ICONS[n.type] ?? (
                          <Bell className="h-4 w-4 text-zinc-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {title}
                        </p>
                        {body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                            {body}
                          </p>
                        )}
                        <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                          {new Date(n.createdAt).toLocaleString(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {notifications.length > 0 && (
            <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-700">
              <Link
                href="/admin/notifications"
                onClick={() => setOpen(false)}
                className="block rounded-lg py-2 text-center text-sm font-medium text-indigo-600 transition-all duration-300 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
              >
                {t("topbar.viewAllNotifications")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
