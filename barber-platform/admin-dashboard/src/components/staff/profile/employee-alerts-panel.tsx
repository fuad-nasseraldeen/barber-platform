"use client";

import { ShieldAlert } from "lucide-react";

type EmployeeAlertsPanelProps = {
  title: string;
  alerts: Array<{ id: string; message: string; tone: "warning" | "danger" | "info" }>;
  isRtl: boolean;
  emptyLabel: string;
};

export function EmployeeAlertsPanel({ title, alerts, isRtl, emptyLabel }: EmployeeAlertsPanelProps) {
  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_16px_34px_-24px_rgba(0,0,0,0.45)] dark:border-zinc-700 dark:bg-zinc-900">
      <h3 className={`flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 ${isRtl ? "flex-row-reverse justify-end" : ""}`}>
        <ShieldAlert className="h-4 w-4 text-primary" />
        {title}
      </h3>

      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <p className={`rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400 ${isRtl ? "text-right" : ""}`}>
            {emptyLabel}
          </p>
        ) : null}
        {alerts.map((alert) => {
          const toneStyle =
            alert.tone === "danger"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
              : alert.tone === "warning"
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                : "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300";

          return (
            <p key={alert.id} className={`rounded-2xl border px-3 py-2 text-xs ${toneStyle}`}>
              {alert.message}
            </p>
          );
        })}
      </div>
    </article>
  );
}
