"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { PrevArrow, NextArrow } from "@/components/ui/nav-arrow";
interface InsightsPanelProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function InsightsPanel({
  children,
  defaultOpen = true,
}: InsightsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`flex shrink-0 flex-col border-s border-zinc-200/80 bg-white transition-all dark:border-zinc-800/80 dark:bg-zinc-950 ${
        open ? "w-72" : "w-0 overflow-hidden"
      }`}
    >
      <div className="flex h-14 items-center justify-between border-b border-zinc-200/80 px-4 dark:border-zinc-800/80">
        {open && (
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Insights</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          aria-label={open ? "Collapse panel" : "Expand panel"}
        >
          {open ? (
            <NextArrow className="h-4 w-4" />
          ) : (
            <PrevArrow className="h-4 w-4" />
          )}
        </button>
      </div>
      {open && <div className="flex-1 overflow-auto p-4">{children}</div>}
    </div>
  );
}
