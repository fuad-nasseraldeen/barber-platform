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
  /** "כולם" / "All" label */
  allLabel: string;
};

export function StaffSelector({
  staffList,
  selected,
  onSelect,
  allLabel,
}: StaffSelectorProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
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
