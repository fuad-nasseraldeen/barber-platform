"use client";

import { useRef, useEffect, useCallback } from "react";
import { DateTime } from "luxon";
import { parseAppointmentApiInstant } from "@/lib/appointment-calendar-time";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { Plane, ArrowUpToLine } from "lucide-react";
import { wallClockMs } from "@/lib/time";

const SLOT_HEIGHT = 48;
const START_HOUR = 8;
const END_HOUR = 22;
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR;

function formatDateInZone(d: Date, zone: string) {
  return DateTime.fromJSDate(d).setZone(zone).toISODate() ?? "";
}

function formatTimeIso(s: string, zone: string) {
  return parseAppointmentApiInstant(s).setZone(zone).toFormat("HH:mm");
}

function minutesFromStart(hour: number, minute: number): number {
  return (hour - START_HOUR) * 60 + minute;
}

function topFromTime(h: number, m: number): number {
  return (minutesFromStart(h, m) / 30) * SLOT_HEIGHT;
}

function heightFromDuration(minutes: number): number {
  return Math.max(SLOT_HEIGHT / 2, (minutes / 30) * SLOT_HEIGHT);
}

export type DayScheduleAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff?: { id: string; firstName: string; lastName: string };
  service: { name: string };
  customer: { firstName: string | null; lastName: string | null; email?: string };
};

export type DayScheduleVacation = {
  id: string;
  staff: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
};

export type DayScheduleBreak = {
  id: string;
  startTime: string;
  endTime: string;
};

export type DayScheduleProps = {
  date: Date;
  appointments: DayScheduleAppointment[];
  vacations: DayScheduleVacation[];
  breaks?: DayScheduleBreak[];
  staffColor: (staffId: string | undefined) => string;
  /** Override: get color per appointment (e.g. by status). When set, staffColor is ignored for appointments. */
  getAppointmentColor?: (apt: DayScheduleAppointment) => string;
  staffAvatarMap: Map<string, string | null>;
  customerName: (c: { firstName?: string | null; lastName?: string | null; email?: string } | null) => string;
  vacationLabel: string;
  onDateSelect?: (date: Date) => void;
  /** Days to show in day selector (today + N days) */
  daySelectorDays?: number;
  locale?: string;
  /** Called when user clicks an appointment block */
  onAppointmentClick?: (apt: DayScheduleAppointment) => void;
  /** Business IANA zone for layout + “now” line (defaults to browser zone). */
  businessTimezone?: string;
};

export function DayScheduleView({
  date,
  appointments,
  vacations,
  breaks = [],
  staffColor,
  getAppointmentColor,
  staffAvatarMap,
  customerName,
  vacationLabel,
  onDateSelect,
  daySelectorDays = 5,
  locale = "he",
  onAppointmentClick,
  businessTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: DayScheduleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTimeRef = useRef(0);
  const zone = businessTimezone;

  const isToday = (d: Date) => {
    const a = DateTime.fromJSDate(d).setZone(zone).toISODate();
    const b = DateTime.now().setZone(zone).toISODate();
    return a === b;
  };
  const selectedIsToday = isToday(date);

  const currentTimeTop = (() => {
    if (!selectedIsToday) return null;
    const now = DateTime.now().setZone(zone);
    return topFromTime(now.hour, now.minute);
  })();

  const scrollToCurrentTime = useCallback(() => {
    if (!selectedIsToday || currentTimeTop == null || !scrollRef.current) return;
    const container = scrollRef.current;
    const viewportHeight = container.clientHeight;
    const targetScroll = Math.max(0, currentTimeTop - viewportHeight / 2 + SLOT_HEIGHT);
    container.scrollTo({
      top: targetScroll,
      behavior: "smooth",
    });
  }, [selectedIsToday, currentTimeTop]);

  useEffect(() => {
    if (!selectedIsToday) return;
    scrollTimeoutRef.current = setTimeout(scrollToCurrentTime, 5000);
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [selectedIsToday, scrollToCurrentTime, date]);

  const handleScroll = useCallback(() => {
    lastScrollTimeRef.current = wallClockMs();
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    scrollTimeoutRef.current = setTimeout(() => {
      scrollToCurrentTime();
    }, 5000);
  }, [scrollToCurrentTime]);

  const dateStr = formatDateInZone(date, zone);
  const dayAppointments = appointments.filter((a) => {
    const ymd = parseAppointmentApiInstant(a.startTime).setZone(zone).toISODate();
    return ymd === dateStr;
  });
  const dayBreaks = breaks.filter((b) => {
    const ymd = parseAppointmentApiInstant(String(b.startTime)).setZone(zone).toISODate();
    return ymd === dateStr;
  });

  const todayStart = DateTime.now().setZone(zone).startOf("day");
  const days = Array.from({ length: daySelectorDays }, (_, i) =>
    todayStart.plus({ days: i }).toJSDate(),
  );

  const dayLabels: Record<number, string> = {
    0: locale === "he" ? "היום" : locale === "ar" ? "اليوم" : "Today",
    1: locale === "he" ? "מחר" : locale === "ar" ? "غداً" : "Tomorrow",
  };

  return (
    <div className="flex flex-col gap-4">
      {onDateSelect && (
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {locale === "he" ? "בחר יום" : locale === "ar" ? "اختر اليوم" : "Choose day"}
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => {
              const selected = formatDateInZone(d, zone) === dateStr;
              const label =
                dayLabels[i] ??
                DateTime.fromJSDate(d).setZone(zone).setLocale(locale).toFormat("ccc");
              return (
                <button
                  key={formatDateInZone(d, zone)}
                  type="button"
                  onClick={() => onDateSelect(d)}
                  className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl px-4 py-3 transition-all duration-200 ${
                    selected
                      ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/25"
                      : "border border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-zinc-500"
                  }`}
                >
                  <span className="text-lg font-bold tabular-nums">
                    {DateTime.fromJSDate(d).setZone(zone).day}
                  </span>
                  <span className="text-xs font-medium opacity-90">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative max-h-[70vh]">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
        <div className="relative flex" style={{ minHeight: TOTAL_SLOTS * SLOT_HEIGHT }}>
          {/* Time labels - fixed width */}
          <div
            className="z-10 shrink-0 border-r border-zinc-200 bg-zinc-50/80 py-2 dark:border-zinc-700 dark:bg-zinc-800/80"
            style={{ width: 56 }}
            dir="ltr"
          >
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
              <div
                key={i}
                className="pr-2 text-right text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400"
                style={{ height: SLOT_HEIGHT * SLOTS_PER_HOUR, lineHeight: `${SLOT_HEIGHT * SLOTS_PER_HOUR}px` }}
              >
                {String(START_HOUR + i).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Content area */}
          <div className="relative flex-1" style={{ minHeight: TOTAL_SLOTS * SLOT_HEIGHT }}>
            {/* Time grid */}
            {Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-b border-dashed border-zinc-200/80 dark:border-zinc-600/50"
                style={{ top: i * SLOT_HEIGHT, height: 1 }}
              />
            ))}
            {/* Current time line - gradient with many beautiful colors */}
            {currentTimeTop != null && (
              <div
                className="absolute left-0 right-0 z-20 flex items-center px-2"
                style={{ top: currentTimeTop }}
              >
                <div
                  className="h-1 flex-1 rounded-full shadow-lg"
                  style={{
                    background: "linear-gradient(90deg, #ec4899, #8b5cf6, #f59e0b, #10b981, #06b6d4, #ec4899)",
                  }}
                />
                <div
                  className="ml-2 h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-md dark:ring-zinc-800"
                  style={{
                    background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                  }}
                />
              </div>
            )}

            {/* Breaks - gray block with diagonal stripes */}
            {dayBreaks.map((br) => {
              const start = parseAppointmentApiInstant(br.startTime).setZone(zone);
              const end = parseAppointmentApiInstant(br.endTime).setZone(zone);
              const durationMin = Math.max(0, Math.round(end.diff(start, "minutes").minutes));
              const top = topFromTime(start.hour, start.minute);
              const height = heightFromDuration(durationMin);
              return (
                <div
                  key={br.id}
                  className="absolute left-2 right-2 z-5 flex items-center justify-center rounded-xl border border-zinc-300 px-3 py-2 dark:border-zinc-600"
                  style={{
                    top,
                    minHeight: height,
                    background: `repeating-linear-gradient(
                      -45deg,
                      rgba(113, 113, 122, 0.25),
                      rgba(113, 113, 122, 0.25) 8px,
                      rgba(161, 161, 170, 0.12) 8px,
                      rgba(161, 161, 170, 0.12) 16px
                    )`,
                  }}
                >
                  <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                    {locale === "he" ? "הפסקה" : locale === "ar" ? "استراحة" : "Break"}
                  </span>
                  <span className="mr-2 text-xs text-zinc-500 tabular-nums">
                    {formatTimeIso(br.startTime, zone)} – {formatTimeIso(br.endTime, zone)}
                  </span>
                </div>
              );
            })}

            {/* Vacations - full day block spanning all hours (8–22), diagonal stripes, yellow border */}
            {vacations.length > 0 && (
              <div
                className="absolute left-2 right-2 top-0 z-5 flex flex-wrap items-center gap-2 rounded-xl border-2 border-amber-400/90 px-3 py-2 dark:border-amber-500/80"
                style={{
                  top: 0,
                  minHeight: TOTAL_SLOTS * SLOT_HEIGHT,
                  background: `repeating-linear-gradient(
                    -45deg,
                    rgba(251, 191, 36, 0.18),
                    rgba(251, 191, 36, 0.18) 10px,
                    rgba(245, 158, 11, 0.06) 10px,
                    rgba(245, 158, 11, 0.06) 20px
                  )`,
                }}
              >
                {vacations.map((v) => (
                  <div key={v.id} className="flex items-center gap-2">
                    <StaffAvatar
                      avatarUrl={v.staff.avatarUrl ?? null}
                      firstName={v.staff.firstName}
                      lastName={v.staff.lastName}
                      size="sm"
                      className="shrink-0"
                    />
                    <Plane className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      {v.staff.firstName} {v.staff.lastName}
                    </span>
                  </div>
                ))}
                <span className="text-sm font-semibold text-amber-800/90 dark:text-amber-200/90">
                  – {vacationLabel}
                </span>
              </div>
            )}

            {/* Appointments */}
            {dayAppointments.map((apt) => {
              const start = parseAppointmentApiInstant(apt.startTime).setZone(zone);
              const end = parseAppointmentApiInstant(apt.endTime).setZone(zone);
              const durationMin = Math.max(0, Math.round(end.diff(start, "minutes").minutes));
              const top = topFromTime(start.hour, start.minute);
              const height = heightFromDuration(durationMin);
              const colorClass = getAppointmentColor ? getAppointmentColor(apt) : staffColor(apt.staff?.id);
              const staffAvatar = apt.staff ? staffAvatarMap.get(apt.staff.id) : null;

              return (
                <button
                  key={apt.id}
                  type="button"
                  onClick={() => onAppointmentClick?.(apt)}
                  className={`absolute left-2 right-2 z-10 flex items-start gap-2 rounded-xl px-3 py-2 text-right shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] ${colorClass} ${onAppointmentClick ? "cursor-pointer" : "cursor-default"}`}
                  style={{ top, minHeight: height }}
                >
                  <StaffAvatar
                    avatarUrl={staffAvatar ?? null}
                    firstName={apt.staff?.firstName ?? apt.customer?.firstName ?? ""}
                    lastName={apt.staff?.lastName ?? apt.customer?.lastName ?? ""}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1 overflow-hidden text-right">
                    <p className="mt-0.5 text-xs tabular-nums opacity-90">
                      {formatTimeIso(apt.startTime, zone)} – {formatTimeIso(apt.endTime, zone)}
                    </p>
                    <p className="truncate font-semibold">{customerName(apt.customer)}</p>
                    <p className="truncate text-xs opacity-90">
                      {locale === "he"
                        ? `מגיע ל${apt.service?.name ?? "—"}`
                        : locale === "ar"
                        ? `يأتي لـ ${apt.service?.name ?? "—"}`
                        : `${apt.service?.name ?? "—"}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        </div>
        {/* FAB for scroll to current time - fixed at bottom right of container */}
        {selectedIsToday && (
          <button
            type="button"
            onClick={scrollToCurrentTime}
            className="absolute bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
            title={locale === "he" ? "גלול לשעה הנוכחית" : "Scroll to current time"}
          >
            <ArrowUpToLine className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
