"use client";

type EmployeeGoalProgressCardProps = {
  title: string;
  subtitle: string;
  progressPercent: number;
  currentValue: string;
  targetValue: string;
  isRtl: boolean;
};

export function EmployeeGoalProgressCard({
  title,
  subtitle,
  progressPercent,
  currentValue,
  targetValue,
  isRtl,
}: EmployeeGoalProgressCardProps) {
  const safe = Math.max(0, Math.min(100, progressPercent));

  return (
    <article className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className={isRtl ? "text-right" : "text-left"}>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full"
          style={{
            width: `${safe}%`,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--primary) 90%, white), color-mix(in srgb, var(--primary) 60%, black))",
            boxShadow: "0 0 16px color-mix(in srgb, var(--primary) 35%, transparent)",
          }}
        />
      </div>

      <div className={`mt-3 flex items-center justify-between gap-2 text-sm ${isRtl ? "flex-row-reverse" : ""}`}>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{safe.toFixed(0)}%</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {currentValue} / {targetValue}
        </span>
      </div>
    </article>
  );
}
