"use client";

import { useMemo, useState } from "react";
import { HandCoins } from "lucide-react";
import type { EmployeeAdvanceItem } from "@/components/staff/profile/types";

type EmployeeAdvancesPanelProps = {
  title: string;
  subtitle: string;
  advances: EmployeeAdvanceItem[];
  onAddAdvance: (item: Omit<EmployeeAdvanceItem, "id">) => void;
  formatCurrency: (amount: number) => string;
  isRtl: boolean;
  labels: {
    amount: string;
    date: string;
    note: string;
    addAdvance: string;
    empty: string;
    totalDeducted: string;
    impactLabel: string;
  };
  totalDeductedAmount: number;
  impactAmount: number;
};

export function EmployeeAdvancesPanel({
  title,
  subtitle,
  advances,
  onAddAdvance,
  formatCurrency,
  isRtl,
  labels,
  totalDeductedAmount,
  impactAmount,
}: EmployeeAdvancesPanelProps) {
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const orderedAdvances = useMemo(
    () => [...advances].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [advances],
  );

  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_16px_34px_-24px_rgba(0,0,0,0.45)] dark:border-zinc-700 dark:bg-zinc-900">
      <div className={isRtl ? "text-right" : "text-left"}>
        <h3 className={`flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 ${isRtl ? "flex-row-reverse" : ""}`}>
          <HandCoins className="h-4 w-4 text-primary" />
          {title}
        </h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{labels.totalDeducted}</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(totalDeductedAmount)}</p>
        </div>
        <div
          className="rounded-2xl border px-3 py-2"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
            background: "color-mix(in srgb, var(--primary) 10%, transparent)",
          }}
        >
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{labels.impactLabel}</p>
          <p className="mt-1 text-lg font-semibold text-primary">{formatCurrency(impactAmount)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <label className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="mb-1 block">{labels.amount}</span>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="mb-1 block">{labels.date}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="text-xs text-zinc-600 dark:text-zinc-300 md:col-span-2">
          <span className="mb-1 block">{labels.note}</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
            <button
              type="button"
              onClick={() => {
                if (amount <= 0 || !date) return;
                onAddAdvance({ amount, date, note: note.trim() || undefined });
                setAmount(0);
                setNote("");
              }}
              className="btn-primary rounded-xl px-3 py-2 text-xs font-semibold"
            >
              {labels.addAdvance}
            </button>
          </div>
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {orderedAdvances.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{labels.empty}</p>
        ) : (
          orderedAdvances.map((advance) => (
            <div
              key={advance.id}
              className={`flex items-center justify-between gap-2 rounded-2xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700 ${
                isRtl ? "flex-row-reverse" : ""
              }`}
            >
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(advance.amount)}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{advance.date}</span>
              <span className="truncate text-zinc-500 dark:text-zinc-400">{advance.note ?? "-"}</span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
