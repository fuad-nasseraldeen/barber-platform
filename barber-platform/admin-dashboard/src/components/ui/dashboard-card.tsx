"use client";

import { ReactNode } from "react";

interface DashboardCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: number;
  changeLabel?: string;
  gradient?: boolean;
}

export function DashboardCard({
  title,
  value,
  icon,
  change,
  changeLabel,
  gradient = false,
}: DashboardCardProps) {
  return (
    <div
      className={`group rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out hover:scale-[1.02] hover:shadow-xl dark:border-zinc-700/80 dark:bg-zinc-900/50 ${
        gradient
          ? "bg-[color-mix(in_srgb,var(--primary)_15%,transparent)]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`rounded-xl p-3 transition-transform duration-300 group-hover:scale-105 ${
              gradient
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {title}
            </p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {change !== undefined && (
              <p
                className={`mt-1 text-xs font-medium ${
                  change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {change >= 0 ? "+" : ""}
                {change}% {changeLabel ?? "vs last period"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
