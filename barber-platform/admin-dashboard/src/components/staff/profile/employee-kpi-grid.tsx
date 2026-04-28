"use client";

import type { EmployeeKpiItem } from "@/components/staff/profile/types";
import { AnimatedNumber } from "@/components/staff/profile/animated-number";

type EmployeeKpiGridProps = {
  items: EmployeeKpiItem[];
  isRtl: boolean;
};

export function EmployeeKpiGrid({ items, isRtl }: EmployeeKpiGridProps) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
      {items.map((item) => (
        <article
          key={item.id}
          className="group rounded-2xl border p-4 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)] transition-all duration-300 hover:-translate-y-0.5"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
            background:
              "linear-gradient(165deg, color-mix(in srgb, var(--primary) 14%, transparent), color-mix(in srgb, var(--background) 96%, white))",
          }}
        >
          <div className={`mb-3 flex items-center justify-between gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl ring-1"
              style={{
                background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                color: "var(--primary)",
                borderColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
              }}
            >
              <item.icon className="h-4 w-4" />
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                item.tone === "positive"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : item.tone === "negative"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    : item.tone === "warning"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {item.id.toUpperCase()}
            </span>
          </div>
          <p className={`text-xs text-zinc-600 dark:text-zinc-300 ${isRtl ? "text-right" : "text-left"}`}>
            {item.label}
          </p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 ${isRtl ? "text-right" : "text-left"}`}>
            <AnimatedNumber
              value={item.value}
              prefix={item.valuePrefix}
              suffix={item.valueSuffix}
              decimals={item.decimals}
            />
          </p>
          {item.secondary ? (
            <p className={`mt-1 text-xs text-zinc-500 dark:text-zinc-400 ${isRtl ? "text-right" : "text-left"}`}>
              {item.secondary}
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
