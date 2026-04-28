"use client";

import { Clock } from "lucide-react";

const DAYS = [
  { d: 0, key: "staff.days.sun" },
  { d: 1, key: "staff.days.mon" },
  { d: 2, key: "staff.days.tue" },
  { d: 3, key: "staff.days.wed" },
  { d: 4, key: "staff.days.thu" },
  { d: 5, key: "staff.days.fri" },
  { d: 6, key: "staff.days.sat" },
] as const;

export interface StaffWeeklyHoursPanelProps {
  t: (key: string) => string;
  workingHours: Record<number, { start: string; end: string }>;
  setWorkingHours: React.Dispatch<
    React.SetStateAction<Record<number, { start: string; end: string }>>
  >;
  dayEnabled: Record<number, boolean>;
  setDayEnabled: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  hasBookableWorkingHours: boolean;
  showDefaultHint?: boolean;
  saveLabel: string;
  savingLabel: string;
  onSave: () => void;
  saving: boolean;
}

export function StaffWeeklyHoursPanel({
  t,
  workingHours,
  setWorkingHours,
  dayEnabled,
  setDayEnabled,
  hasBookableWorkingHours,
  showDefaultHint,
  saveLabel,
  savingLabel,
  onSave,
  saving,
}: StaffWeeklyHoursPanelProps) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/40">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Clock className="h-4 w-4 text-zinc-500" />
          {t("staff.workingHours")}
        </h3>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving ? savingLabel : saveLabel}
        </button>
      </div>
      {showDefaultHint && (
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t("staff.workingHoursDefaultHint")}</p>
      )}
      {!hasBookableWorkingHours && (
        <p
          className="mb-4 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          {t("staff.workingHoursMissingWarning")}
        </p>
      )}
      <div className="space-y-2">
        {DAYS.map(({ d, key }) => {
          const on = dayEnabled[d] !== false;
          return (
            <div
              key={d}
              className="flex flex-col gap-2 rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-800/40"
            >
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
                  checked={on}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setDayEnabled((prev) => ({ ...prev, [d]: checked }));
                    if (!checked) {
                      setWorkingHours((p) => {
                        const n = { ...p };
                        delete n[d];
                        return n;
                      });
                    } else {
                      setWorkingHours((p) => ({
                        ...p,
                        [d]: p[d] ?? { start: "09:00", end: "18:00" },
                      }));
                    }
                  }}
                />
                <span className="w-9">{t(key)}</span>
              </label>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <input
                  type="time"
                  disabled={!on}
                  value={workingHours[d]?.start ?? ""}
                  onChange={(e) =>
                    setWorkingHours((p) => ({
                      ...p,
                      [d]: { start: e.target.value, end: p[d]?.end ?? "" },
                    }))
                  }
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="text-zinc-400">–</span>
                <input
                  type="time"
                  disabled={!on}
                  value={workingHours[d]?.end ?? ""}
                  onChange={(e) =>
                    setWorkingHours((p) => ({
                      ...p,
                      [d]: { start: p[d]?.start ?? "", end: e.target.value },
                    }))
                  }
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
