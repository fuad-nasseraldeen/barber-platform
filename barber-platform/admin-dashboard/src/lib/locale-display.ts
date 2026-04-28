import type { Locale } from "@/stores/locale-store";

export function appLocaleToBcp47(locale: Locale): string {
  if (locale === "he") return "he-IL";
  if (locale === "ar") return "ar-SA";
  return "en-US";
}

/** `dayOfWeek`: 0 = Sunday … 6 = Saturday (same as backend / `Date.getDay`). */
export function formatWeekdayLongDayOfWeek(dayOfWeek: number, locale: Locale): string {
  const d = new Date(2024, 0, 7 + dayOfWeek);
  return d.toLocaleDateString(appLocaleToBcp47(locale), { weekday: "long" });
}

/** `ymd` calendar date `YYYY-MM-DD` (local semantic). */
export function formatLongWeekdayDateYmd(ymd: string, locale: Locale): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString(appLocaleToBcp47(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
