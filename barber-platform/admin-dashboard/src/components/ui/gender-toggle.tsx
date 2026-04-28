"use client";

import { useTranslation } from "@/hooks/use-translation";

/** Match mobile reference: blue male, pink female, lavender thumb */
const MALE_COLOR = "#6BA3E8";
const FEMALE_COLOR = "#E94DB8";
const THUMB_BG = "#D896FF";
const TRACK_FROM = "#FCE7F6";
const TRACK_TO = "#D9EBFA";

export type GenderToggleValue = "" | "MALE" | "FEMALE" | "OTHER";

export interface GenderToggleProps {
  value: GenderToggleValue;
  onChange: (v: GenderToggleValue) => void;
  /** Show “other” as text action (e.g. customers) */
  allowOther?: boolean;
  labelKey?: string;
  /** Highlight track when required but empty (after submit attempt) */
  showError?: boolean;
  className?: string;
}

export function GenderToggle({
  value,
  onChange,
  allowOther = false,
  labelKey = "customers.gender",
  showError = false,
  className = "",
}: GenderToggleProps) {
  const t = useTranslation();

  /** Empty must not look like "female selected" (same bug as thumb-left + bright pink label). */
  const thumbPosition =
    value === "MALE"
      ? "calc(100% - 2.125rem)"
      : value === "FEMALE"
        ? "0.25rem"
        : "calc(50% - 1.0625rem)";

  const toggle = () => {
    if (value === "OTHER" || value === "") {
      onChange("FEMALE");
      return;
    }
    onChange(value === "MALE" ? "FEMALE" : "MALE");
  };

  return (
    <div className={className}>
      <div className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t(labelKey)}</div>
      {/* Physical layout: female left, male right (same as Hebrew screenshots) */}
      <div dir="ltr" className="flex items-center justify-center gap-3 sm:gap-4">
        <span
          className="min-w-0 shrink text-sm font-semibold transition-opacity sm:text-[0.95rem]"
          style={{
            color: FEMALE_COLOR,
            opacity: value === "FEMALE" ? 1 : value === "" ? 0.6 : 0.5,
          }}
        >
          {t("customers.genderFemale")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value === "MALE"}
          aria-label={t("customers.gender")}
          onClick={toggle}
          className={`relative h-10 w-[5.25rem] shrink-0 rounded-full p-0.5 shadow-inner transition-[box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
            showError && !value ? "ring-2 ring-red-400 ring-offset-2 dark:ring-offset-zinc-900" : ""
          }`}
          style={{
            background: `linear-gradient(90deg, ${TRACK_FROM} 0%, ${TRACK_TO} 100%)`,
          }}
        >
          <span
            className="absolute top-1 h-8 w-[2.125rem] rounded-full shadow-md transition-[left] duration-200 ease-out"
            style={{ left: thumbPosition, backgroundColor: THUMB_BG }}
          />
        </button>
        <span
          className="min-w-0 shrink text-sm font-semibold transition-opacity sm:text-[0.95rem]"
          style={{
            color: MALE_COLOR,
            opacity: value === "MALE" ? 1 : value === "" ? 0.6 : 0.5,
          }}
        >
          {t("customers.genderMale")}
        </span>
      </div>
      {allowOther && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => onChange(value === "OTHER" ? "" : "OTHER")}
            className={`text-xs font-medium underline decoration-zinc-400 underline-offset-2 transition-colors hover:text-violet-600 dark:hover:text-violet-400 ${
              value === "OTHER" ? "text-violet-600 dark:text-violet-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {t("customers.genderOther")}
          </button>
        </div>
      )}
    </div>
  );
}
