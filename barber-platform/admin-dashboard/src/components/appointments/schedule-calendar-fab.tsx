"use client";

import { useState, useRef, useEffect } from "react";
import { CalendarPlus, Clock, MoreHorizontal, Scissors, Settings2 } from "lucide-react";

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type ScheduleCalendarFabProps = {
  items: MenuItem[];
  dir?: "rtl" | "ltr";
};

export function ScheduleCalendarFab({ items, dir = "rtl" }: ScheduleCalendarFabProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      ref={rootRef}
      dir={dir}
      className="fixed z-[220] flex flex-col items-center gap-2 end-4 max-lg:bottom-[max(1rem,calc(5rem+env(safe-area-inset-bottom,0px)))] lg:bottom-5"
    >
      {open && (
        <div className="schedule-fab-menu-enter mb-1 flex min-w-[11.5rem] flex-col gap-0.5 rounded-xl border border-zinc-200/80 bg-white/95 p-1.5 text-xs shadow-xl backdrop-blur-md dark:border-zinc-600 dark:bg-zinc-900/95">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-medium text-zinc-800 transition-colors hover:bg-[var(--primary)]/10 disabled:opacity-40 dark:text-zinc-100"
            >
              <span className="text-[var(--primary)] [&_svg]:h-4 [&_svg]:w-4">{it.icon}</span>
              <span className="leading-tight">{it.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg ring-2 ring-[var(--primary)]/25 transition-transform hover:scale-105 active:scale-95"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

export const FabIcons = { CalendarPlus, Clock, Scissors, Settings2 };
