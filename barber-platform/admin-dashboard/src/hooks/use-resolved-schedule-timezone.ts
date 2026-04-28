"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

/**
 * Prisma / register default is often "UTC" while timestamps are stored as UTC instants — still need a
 * wall-clock zone for the schedule. Prefer a real business IANA id; treat bare "UTC" as unset.
 */
const SCHEDULE_FALLBACK_IANA = "Asia/Jerusalem";

/**
 * Calendar wall-clock: business timezone when set to a non-placeholder zone.
 * UTC / empty → Israel default (then browser after mount, then UTC).
 */
export function useResolvedScheduleTimeZone(stored: string | null | undefined): string {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return useMemo(() => {
    const raw = (stored ?? "").trim();
    if (raw && raw.toUpperCase() !== "UTC" && DateTime.now().setZone(raw).isValid) return raw;
    if (DateTime.now().setZone(SCHEDULE_FALLBACK_IANA).isValid) return SCHEDULE_FALLBACK_IANA;
    if (mounted && typeof window !== "undefined") {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local && DateTime.now().setZone(local).isValid) return local;
    }
    return "UTC";
  }, [stored, mounted]);
}
