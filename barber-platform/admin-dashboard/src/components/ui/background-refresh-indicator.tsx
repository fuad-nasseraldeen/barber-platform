"use client";

import { Loader2 } from "lucide-react";

export function BackgroundRefreshIndicator({
  active,
  className = "",
  label,
}: {
  active: boolean;
  className?: string;
  label?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/85 px-2 py-1 text-[11px] font-medium text-zinc-600 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 ${className}`}
    >
      <Loader2 className="h-3 w-3 animate-spin text-[var(--primary)]" />
      {label ? <span className="tracking-wide">{label}</span> : null}
      <span className="sr-only">Loading</span>
    </div>
  );
}
