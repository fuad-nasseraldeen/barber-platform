"use client";

import { BadgeDollarSign, TriangleAlert } from "lucide-react";
import type { EmployeeSettlementSummary } from "@/lib/staff/employee-settlement";

type EmployeeSettlementSummaryProps = {
  title: string;
  summary: EmployeeSettlementSummary;
  formatCurrency: (value: number) => string;
  labels: {
    grossBeforeAdvances: string;
    advances: string;
    afterAdvances: string;
    alreadyPaid: string;
    remainingToPay: string;
    finalPayable: string;
  };
  isRtl: boolean;
};

export function EmployeeSettlementSummary({
  title,
  summary,
  formatCurrency,
  labels,
  isRtl,
}: EmployeeSettlementSummaryProps) {
  const rows = [
    [labels.grossBeforeAdvances, summary.grossBeforeAdvances],
    [labels.advances, -summary.advancesDeducted],
    [labels.afterAdvances, summary.afterAdvances],
    [labels.alreadyPaid, -summary.alreadyPaid],
    [labels.remainingToPay, summary.remainingToPay],
  ] as const;

  const isNegative = summary.remainingToPay < 0;

  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_16px_34px_-24px_rgba(0,0,0,0.45)] dark:border-zinc-700 dark:bg-zinc-900">
      <div className={`flex items-center justify-between gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
        <h3 className={`flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 ${isRtl ? "flex-row-reverse" : ""}`}>
          <BadgeDollarSign className="h-4 w-4 text-primary" />
          {title}
        </h3>
        {isNegative ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <TriangleAlert className="h-3.5 w-3.5" />
            NEGATIVE
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className={`flex items-center justify-between gap-3 ${isRtl ? "flex-row-reverse" : ""}`}>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {value < 0 ? "-" : ""}
              {formatCurrency(Math.abs(value))}
            </span>
          </div>
        ))}
      </div>

      <div
        className={`mt-5 flex items-center justify-between rounded-2xl border px-4 py-3 ${isRtl ? "flex-row-reverse" : ""}`}
        style={{
          borderColor: isNegative
            ? "color-mix(in srgb, #ef4444 36%, transparent)"
            : "color-mix(in srgb, var(--primary) 32%, transparent)",
          background: isNegative
            ? "color-mix(in srgb, #ef4444 11%, transparent)"
            : "color-mix(in srgb, var(--primary) 16%, transparent)",
        }}
      >
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{labels.finalPayable}</span>
        <span
          className="text-2xl font-semibold tracking-tight"
          style={{ color: isNegative ? "#dc2626" : "var(--primary)" }}
        >
          {isNegative ? "-" : ""}
          {formatCurrency(Math.abs(summary.remainingToPay))}
        </span>
      </div>
    </article>
  );
}
