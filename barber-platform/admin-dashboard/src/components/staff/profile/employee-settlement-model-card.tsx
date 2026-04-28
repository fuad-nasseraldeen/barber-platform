"use client";

import { Calculator } from "lucide-react";
import type { EmployeeSettlementModel } from "@/lib/staff/employee-settlement";

type EmployeeSettlementModelCardProps = {
  title: string;
  selectedModel: EmployeeSettlementModel;
  onModelChange: (model: EmployeeSettlementModel) => void;
  formulaText: string;
  isRtl: boolean;
  labels: {
    boothRental: string;
    percentage: string;
    fixedPerTreatment: string;
    modelLabel: string;
    formulaLabel: string;
    boothAmount: string;
    businessCutPercent: string;
    fixedAmountPerTreatment: string;
    allowNegativeBalance: string;
    alreadyPaid: string;
  };
  inputs: {
    boothRentalAmount: number;
    businessCutPercent: number;
    fixedAmountPerTreatment: number;
    allowNegativeBalance: boolean;
    alreadyPaid: number;
  };
  onInputsChange: {
    setBoothRentalAmount: (value: number) => void;
    setBusinessCutPercent: (value: number) => void;
    setFixedAmountPerTreatment: (value: number) => void;
    setAllowNegativeBalance: (value: boolean) => void;
    setAlreadyPaid: (value: number) => void;
  };
  readOnly?: boolean;
};

export function EmployeeSettlementModelCard({
  title,
  selectedModel,
  onModelChange,
  formulaText,
  isRtl,
  labels,
  inputs,
  onInputsChange,
  readOnly = false,
}: EmployeeSettlementModelCardProps) {
  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-[0_16px_34px_-24px_rgba(0,0,0,0.45)] dark:border-zinc-700 dark:bg-zinc-900">
      <h3 className={`flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 ${isRtl ? "flex-row-reverse justify-end" : ""}`}>
        <Calculator className="h-4 w-4 text-primary" />
        {title}
      </h3>

      <div className={`mt-3 grid gap-2 sm:grid-cols-3 ${isRtl ? "text-right" : "text-left"}`}>
        {([
          ["boothRental", labels.boothRental],
          ["percentage", labels.percentage],
          ["fixedPerTreatment", labels.fixedPerTreatment],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              if (!readOnly) onModelChange(value);
            }}
            disabled={readOnly}
            className="rounded-2xl border px-3 py-2 text-xs font-medium"
            style={{
              borderColor:
                selectedModel === value
                  ? "color-mix(in srgb, var(--primary) 40%, transparent)"
                  : "color-mix(in srgb, var(--muted-foreground) 18%, transparent)",
              background:
                selectedModel === value
                  ? "color-mix(in srgb, var(--primary) 16%, transparent)"
                  : "transparent",
              color: selectedModel === value ? "var(--primary)" : "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {selectedModel === "boothRental" ? (
          <label className="text-xs text-zinc-600 dark:text-zinc-300">
            <span className="mb-1 block">{labels.boothAmount}</span>
            <input
              type="number"
              min={0}
              value={inputs.boothRentalAmount}
              onChange={(e) => onInputsChange.setBoothRentalAmount(Math.max(0, Number(e.target.value) || 0))}
              readOnly={readOnly}
              disabled={readOnly}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
        ) : null}

        {selectedModel === "percentage" ? (
          <label className="text-xs text-zinc-600 dark:text-zinc-300">
            <span className="mb-1 block">{labels.businessCutPercent}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={inputs.businessCutPercent}
              onChange={(e) =>
                onInputsChange.setBusinessCutPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
              }
              readOnly={readOnly}
              disabled={readOnly}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
        ) : null}

        {selectedModel === "fixedPerTreatment" ? (
          <label className="text-xs text-zinc-600 dark:text-zinc-300">
            <span className="mb-1 block">{labels.fixedAmountPerTreatment}</span>
            <input
              type="number"
              min={0}
              value={inputs.fixedAmountPerTreatment}
              onChange={(e) => onInputsChange.setFixedAmountPerTreatment(Math.max(0, Number(e.target.value) || 0))}
              readOnly={readOnly}
              disabled={readOnly}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
        ) : null}

        <label className="flex items-center gap-2 rounded-2xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
          <input
            type="checkbox"
            checked={inputs.allowNegativeBalance}
            onChange={(e) => onInputsChange.setAllowNegativeBalance(e.target.checked)}
            disabled={readOnly}
          />
          <span>{labels.allowNegativeBalance}</span>
        </label>
        <label className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="mb-1 block">{labels.alreadyPaid}</span>
          <input
            type="number"
            min={0}
            value={inputs.alreadyPaid}
            onChange={(e) => onInputsChange.setAlreadyPaid(Math.max(0, Number(e.target.value) || 0))}
            readOnly={readOnly}
            disabled={readOnly}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
      </div>

      <div
        className="mt-4 rounded-2xl border border-zinc-200 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        style={{
          background: "color-mix(in srgb, var(--primary) 8%, transparent)",
        }}
      >
        <p className="font-semibold">{labels.formulaLabel}</p>
        <p className="mt-1">{formulaText}</p>
      </div>
    </article>
  );
}
