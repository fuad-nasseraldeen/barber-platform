"use client";

export function Skeleton({
  className = "",
  primary = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { primary?: boolean }) {
  return (
    <div
      className={`rounded-xl bg-zinc-200 dark:bg-zinc-700/50 ${primary ? "skeleton-primary" : "animate-pulse"} ${className}`}
      {...props}
    />
  );
}

/** List skeleton for appointments - matches appointment card layout */
export function AppointmentListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
        >
          <Skeleton primary className="h-5 w-14 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton primary className="h-4 w-32" />
            <Skeleton primary className="h-3 w-24" />
          </div>
          <Skeleton primary className="h-6 w-16 shrink-0 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Calendar/day view skeleton for appointments */
export function AppointmentCalendarSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
      <div className="max-h-[60vh] overflow-y-auto">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex border-b border-zinc-100 dark:border-zinc-700/50 last:border-b-0"
          >
            <div className="w-20 shrink-0 border-r border-zinc-200 px-2 py-2 dark:border-zinc-700">
              <Skeleton primary className="h-4 w-10" />
            </div>
            <div className="min-h-[48px] flex-1 p-2">
              <Skeleton primary className="h-8 w-full max-w-48 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** List skeleton for customers - matches customer row layout */
export function CustomerListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-zinc-100 p-3 dark:border-zinc-700"
        >
          <Skeleton primary className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton primary className="h-4 w-36" />
            <Skeleton primary className="h-3 w-28" />
          </div>
          <Skeleton primary className="h-8 w-8 shrink-0 rounded" />
        </div>
      ))}
    </div>
  );
}

/** List skeleton for notifications - matches notification item layout */
export function NotificationListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <Skeleton primary className="mt-0.5 h-4 w-4 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton primary className="h-4 w-full max-w-48" />
            <Skeleton primary className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md transition-all duration-300 ease-in-out dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <Skeleton className="mb-4 h-5 w-32" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-md dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <Skeleton className="mb-4 h-5 w-40" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function DashboardKpiCardSkeleton() {
  return (
    <div className="min-h-[212px] rounded-3xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton primary className="h-3 w-28 rounded" />
          <Skeleton primary className="h-10 w-24 rounded" />
        </div>
        <Skeleton primary className="h-11 w-11 rounded-full" />
      </div>
      <div className="rounded-2xl bg-zinc-100/60 px-2 pt-2 pb-1 dark:bg-zinc-800/40">
        <Skeleton primary className="h-20 w-full rounded-xl" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Skeleton primary className="h-6 w-20 rounded-full" />
        <Skeleton primary className="h-4 w-24 rounded" />
      </div>
    </div>
  );
}

export function TeamGoalsCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="min-h-[280px] rounded-3xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton primary className="h-4 w-36 rounded" />
        <Skeleton primary className="h-4 w-24 rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Skeleton primary className="h-8 w-8 rounded-full" />
              <Skeleton primary className="h-4 w-32 rounded" />
            </div>
            <Skeleton primary className="h-2.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
      <Skeleton primary className="mb-4 h-6 w-40 rounded" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-700">
            <div className="space-y-2">
              <Skeleton primary className="h-4 w-32 rounded" />
              <Skeleton primary className="h-3 w-24 rounded" />
            </div>
            <Skeleton primary className="h-5 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
