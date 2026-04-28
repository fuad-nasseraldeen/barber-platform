"use client";

import { Users } from "lucide-react";
import { StaffAvatar } from "@/components/ui/staff-avatar";

type Staff = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
};

type StaffSelectorProps = {
  staffList: Staff[];
  selected: string;
  onSelect: (staffId: string) => void;
  /** "כולם" / "All" label (only when showAllOption is true) */
  allLabel?: string;
  /** When false, only individual staff cards (no "everyone" tile). */
  showAllOption?: boolean;
  /** Horizontal strip with round avatars / rings (day calendar). */
  variant?: "default" | "premium";
  /** Tighter strip and smaller avatars (day toolbar). */
  compact?: boolean;
};

export function StaffSelector({
  staffList,
  selected,
  onSelect,
  allLabel = "",
  showAllOption = true,
  variant = "default",
  compact = false,
}: StaffSelectorProps) {
  if (variant === "premium") {
    const gap = compact ? "gap-2.5" : "gap-5";
    const tileGap = compact ? "gap-1" : "gap-2";
    const allCircle = compact ? "h-11 w-11" : "h-14 w-14";
    const usersIcon = compact ? "h-5 w-5" : "h-7 w-7";
    const ringSelected = compact ? "ring-[2.5px] ring-offset-1" : "ring-[3px] ring-offset-2";
    const avatarSize = compact ? "md" : "lg";
    const nameMax = compact ? "max-w-[4.25rem]" : "max-w-[5.5rem]";
    const nameClass = compact ? "text-[11px] leading-tight" : "text-xs";

    return (
      <div
        className={`schedule-strip-scroll flex ${gap} overflow-x-auto pb-1.5 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:thin]`}
      >
        {showAllOption && (
          <button
            type="button"
            onClick={() => onSelect("")}
            className={`flex shrink-0 flex-col items-center ${tileGap} transition-transform duration-300 hover:opacity-95`}
          >
            <div
              className={`flex ${allCircle} items-center justify-center rounded-full shadow-md transition-all duration-300 ${
                selected === ""
                  ? `bg-[var(--primary)] text-[var(--primary-foreground)] ${compact ? "ring-2" : "ring-4"} ring-[var(--primary)]/35`
                  : "border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              <Users className={usersIcon} strokeWidth={2} />
            </div>
            <span
              className={`${nameMax} truncate text-center ${nameClass} font-semibold text-zinc-800 dark:text-zinc-100`}
            >
              {allLabel}
            </span>
          </button>
        )}
        {staffList.map((s) => {
          const isSelected = selected === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`flex shrink-0 flex-col items-center ${tileGap} transition-transform duration-300 ${
                isSelected ? (compact ? "scale-[1.02]" : "scale-[1.03]") : "hover:opacity-95"
              }`}
            >
              <StaffAvatar
                avatarUrl={s.avatarUrl ?? null}
                firstName={s.firstName}
                lastName={s.lastName}
                size={avatarSize}
                className={`${compact ? "shadow-md" : "shadow-lg"} transition-all duration-300 ${
                  isSelected
                    ? `${ringSelected} ring-[var(--primary)] ring-offset-white dark:ring-offset-zinc-900`
                    : ""
                }`}
              />
              <span
                className={`${nameMax} truncate text-center ${nameClass} font-semibold text-zinc-800 dark:text-zinc-100`}
              >
                {s.firstName} {s.lastName}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {showAllOption && (
        <button
          type="button"
          onClick={() => onSelect("")}
          className={`flex shrink-0 flex-col items-center gap-1.5 rounded-2xl p-3 transition-all ${
            selected === ""
              ? "border-2 border-[var(--primary)] bg-[var(--primary)]/10"
              : "border border-zinc-200 hover:border-zinc-300 dark:border-zinc-600 dark:hover:border-zinc-500"
          }`}
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              selected === "" ? "bg-[var(--primary)] text-white" : "bg-zinc-100 dark:bg-zinc-700"
            }`}
          >
            <Users className="h-6 w-6" />
          </div>
          <span className="text-xs font-medium">{allLabel}</span>
        </button>
      )}
      {staffList.map((s) => {
        const isSelected = selected === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`flex shrink-0 flex-col items-center gap-1.5 rounded-2xl p-3 transition-all ${
              isSelected
                ? "border-2 border-[var(--primary)] bg-[var(--primary)]/10"
                : "border border-zinc-200 hover:border-zinc-300 dark:border-zinc-600 dark:hover:border-zinc-500"
            }`}
          >
            <StaffAvatar
              avatarUrl={s.avatarUrl ?? null}
              firstName={s.firstName}
              lastName={s.lastName}
              size="md"
              className={`h-12 w-12 ${isSelected ? "ring-2 ring-[var(--primary)]" : ""}`}
            />
            <span className="max-w-[80px] truncate text-xs font-medium">
              {s.firstName} {s.lastName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
