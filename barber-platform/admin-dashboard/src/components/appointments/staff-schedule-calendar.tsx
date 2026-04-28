"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  apiIsoToBusinessWall,
  businessLocalYmdFromIso,
  dayStartInZone,
  formatHhMmInZone,
  hhmmToMinutes,
  jsDayOfWeekInZone,
  snapToStep,
  wallTimeToUtcIso,
} from "@/lib/calendar-business-time";
import { resolveCustomerEventColor } from "@/lib/customer-tag-colors";
import { ChevronRight } from "lucide-react";

const DEFAULT_GRID_START = 7;
const DEFAULT_GRID_END = 21;
const DEFAULT_PX_PER_MIN = 2;
const SNAP_MIN = 5;
const RESIZE_HANDLE_PX = 8;
/** Height of staff name strip above the time grid (matches time-axis spacer). */
const SCHED_COL_HEAD_PX = 40;
const SCROLL_IDLE_MS = 5000;

/** Week view: which day panel is open — DEFAULT = today only; NONE = all folded; else Y-M-D */
type WeekPanelState = "DEFAULT" | "NONE" | string;

export type ScheduleCalendarAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff: { id: string; firstName: string; lastName: string };
  service: { name: string; durationMinutes?: number };
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone?: string | null;
    tagColor?: string | null;
  };
};

export type ScheduleOverlay = {
  id: string;
  staffId: string;
  startTime: string;
  endTime: string;
  /** break = weekly/lunch (orange); time_block = admin blocked slot (gray); vacation = amber */
  variant: "break" | "vacation" | "time_block";
};

export type StaffScheduleRow = {
  id: string;
  firstName: string;
  lastName: string;
  staffWorkingHours?: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
};

type StaffScheduleCalendarProps = {
  businessTimeZone: string;
  /** Each Y-M-D in business zone to render */
  dates: string[];
  staff: StaffScheduleRow[];
  appointments: ScheduleCalendarAppointment[];
  overlays?: ScheduleOverlay[];
  gridStartHour?: number;
  gridEndHour?: number;
  /** Day view: wall time window in minutes-from-midnight (overrides hour props). E.g. shift 08:10–20:00 + padding. */
  gridDayRange?: { startMin: number; endMin: number } | null;
  pxPerMinute?: number;
  locale: string;
  customerName: (c: ScheduleCalendarAppointment["customer"]) => string;
  /** Second line under customer (e.g. “מגיע ל…” + service). */
  formatServiceLine?: (a: ScheduleCalendarAppointment) => string;
  minServiceMinutes?: number;
  debugGapHighlight?: boolean;
  /** Tooltip / label on break stripes in the grid */
  overlayBreakTitle?: string;
  /** Label for admin "block time" (gray) */
  overlayTimeBlockTitle?: string;
  overlayVacationTitle?: string;
  /** User clicked empty slot on a break, or drag-released overlapping a break */
  onInteractionBlocked?: (reason: "click" | "drag") => void;
  canEdit: boolean;
  onAppointmentClick: (a: ScheduleCalendarAppointment) => void;
  onEmptyClick?: (ymd: string, staffId: string, minutesFromMidnight: number) => void;
  onAppointmentPatch?: (
    appointmentId: string,
    staffId: string,
    startIso: string,
    endIso: string,
  ) => Promise<void>;
  /** i18n label for the "today" chip (e.g. appointments.today) */
  todayBadgeLabel: string;
  /** When true, one day panel at a time (default: today only); day view ignores */
  weekAccordion?: boolean;
  /** Snap empty-slot clicks & drag release to this many minutes (e.g. 15). */
  snapToStepMinutes?: number;
  /** Richer cards / borders for day view. */
  visualVariant?: "default" | "premium";
  /** On today's column, keep the “now” line near vertical center (day view). */
  centerNowInView?: boolean;
};

/** Left stripe: same hue as customer (deterministic). Only cancelled / no-show use status red. */
function appointmentStatusAccent(status: string, customerColor: string): string {
  const s = String(status).toUpperCase();
  if (s === "CANCELLED" || s === "NO_SHOW") return "#ef4444";
  return customerColor;
}

function rangesOverlapHalfOpen(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function visibleSegmentMinutes(
  isoStart: string,
  isoEnd: string,
  ymd: string,
  zone: string,
  gridStartMin: number,
  gridEndMin: number,
): { topMin: number; heightMin: number; startMinDay: number; endMinDay: number } | null {
  const dayStart = dayStartInZone(ymd, zone);
  const dayEnd = dayStart.plus({ days: 1 });
  const t0 = apiIsoToBusinessWall(isoStart, zone);
  const t1 = apiIsoToBusinessWall(isoEnd, zone);
  if (!t0.isValid || !t1.isValid || t1 <= dayStart || t0 >= dayEnd) return null;

  const vis0 = t0 < dayStart ? dayStart : t0;
  const vis1 = t1 > dayEnd ? dayEnd : t1;
  const gridStartDt = dayStart.plus({ minutes: gridStartMin });
  const gridEndDt = dayStart.plus({ minutes: gridEndMin });
  const clip0 = vis0 < gridStartDt ? gridStartDt : vis0;
  const clip1 = vis1 > gridEndDt ? gridEndDt : vis1;
  if (clip1 <= clip0) return null;

  const topMin = clip0.diff(dayStart, "minutes").minutes - gridStartMin;
  const heightMin = clip1.diff(clip0, "minutes").minutes;
  const startMinDay = t0.diff(dayStart, "minutes").minutes;
  const endMinDay = t1.diff(dayStart, "minutes").minutes;
  return { topMin, heightMin, startMinDay, endMinDay };
}

function workingBand(
  ymd: string,
  zone: string,
  staff: StaffScheduleRow,
  gridStartMin: number,
  gridEndMin: number,
): { topMin: number; heightMin: number } | null {
  const dow = jsDayOfWeekInZone(ymd, zone);
  const wh = staff.staffWorkingHours?.find((h) => h.dayOfWeek === dow);
  if (!wh) return null;
  const a = hhmmToMinutes(wh.startTime);
  const b = hhmmToMinutes(wh.endTime);
  const grid0 = gridStartMin;
  const grid1 = gridEndMin;
  const clip0 = Math.max(a, grid0);
  const clip1 = Math.min(b, grid1);
  if (clip1 <= clip0) return null;
  return { topMin: clip0 - grid0, heightMin: clip1 - clip0 };
}

type ScheduleDaySectionProps = {
  ymd: string;
  zone: string;
  todayBadgeLabel: string;
  isToday: boolean;
  formatDayTitle: (ymd: string) => string;
  gridStartMin: number;
  gridEndMin: number;
  pxPerMinute: number;
  gridHeightPx: number;
  gridMinutes: number;
  dir: "rtl" | "ltr";
  staff: StaffScheduleRow[];
  appointmentsByDayStaff: Map<string, ScheduleCalendarAppointment[]>;
  overlays: ScheduleOverlay[];
  overlayBreakTitle: string;
  overlayTimeBlockTitle: string;
  overlayVacationTitle: string;
  onInteractionBlocked?: (reason: "click" | "drag") => void;
  customerName: (c: ScheduleCalendarAppointment["customer"]) => string;
  formatServiceLine?: (a: ScheduleCalendarAppointment) => string;
  canEdit: boolean;
  onAppointmentClick: (a: ScheduleCalendarAppointment) => void;
  onEmptyClick?: (ymd: string, staffId: string, minutesFromMidnight: number) => void;
  onAppointmentPatch?: (
    appointmentId: string,
    staffId: string,
    startIso: string,
    endIso: string,
  ) => Promise<void>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  minServiceMinutes: number;
  debugGapHighlight: boolean;
  weekAccordion: boolean;
  isExpanded: boolean;
  onToggleDay: () => void;
  registerDayScrollRef: (el: HTMLDivElement | null) => void;
  /** Week accordion: reset global idle timer on scroll inside a day panel */
  onWeekScreenActivity?: () => void;
  snapToStepMinutes: number;
  visualVariant: "default" | "premium";
  centerNowInView: boolean;
};

/** “Now” on the schedule axis — DB stores UTC instants; zone is business wall clock (e.g. Asia/Jerusalem). */
function nowInScheduleZone(zone: string): DateTime {
  const dt = DateTime.now().setZone(zone);
  return dt.isValid ? dt : DateTime.now().setZone("Asia/Jerusalem");
}

function ScheduleDaySection({
  ymd,
  zone,
  todayBadgeLabel,
  isToday,
  formatDayTitle,
  gridStartMin,
  gridEndMin,
  pxPerMinute,
  gridHeightPx,
  gridMinutes,
  dir,
  staff,
  appointmentsByDayStaff,
  overlays,
  overlayBreakTitle,
  overlayTimeBlockTitle,
  overlayVacationTitle,
  onInteractionBlocked,
  customerName,
  formatServiceLine,
  canEdit,
  onAppointmentClick,
  onEmptyClick,
  onAppointmentPatch,
  draggingId,
  setDraggingId,
  minServiceMinutes,
  debugGapHighlight,
  weekAccordion,
  isExpanded,
  onToggleDay,
  registerDayScrollRef,
  onWeekScreenActivity,
  snapToStepMinutes,
  visualVariant,
  centerNowInView,
}: ScheduleDaySectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const ignoreScrollUntilRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const initialScrollRef = useRef(false);
  const [nowTick, setNowTick] = useState(0);

  const showNowByWallClock = weekAccordion ? isExpanded : isToday;

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((x) => x + 1), centerNowInView && isToday ? 60_000 : 15_000);
    return () => clearInterval(id);
  }, [centerNowInView, isToday]);

  const nowLineTopPx = useMemo(() => {
    if (!showNowByWallClock) return null;
    const now = nowInScheduleZone(zone);
    if (!now.isValid) return null;
    const mins = now.hour * 60 + now.minute + now.second / 60;
    const g0 = gridStartMin;
    const g1 = gridEndMin;
    if (mins < g0 || mins > g1) return null;
    return (mins - g0) * pxPerMinute;
  }, [showNowByWallClock, zone, gridStartMin, gridEndMin, pxPerMinute, nowTick]);

  const timeAxisSlots = useMemo(() => {
    const day0 = dayStartInZone(ymd, zone);
    const slots: { key: string; heightPx: number; label: string }[] = [];
    for (let t = 0; t < gridMinutes; t += 30) {
      const slice = Math.min(30, gridMinutes - t);
      const label = day0.plus({ minutes: gridStartMin + t }).toFormat("HH:mm");
      slots.push({ key: `t-${gridStartMin + t}`, heightPx: slice * pxPerMinute, label });
    }
    return slots;
  }, [ymd, zone, gridMinutes, gridStartMin, pxPerMinute]);

  const scrollToNowCentered = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollRef.current;
      if (!el || nowLineTopPx == null) return;
      const target = SCHED_COL_HEAD_PX + nowLineTopPx - el.clientHeight / 2;
      ignoreScrollUntilRef.current = Date.now() + 800;
      el.scrollTo({ top: Math.max(0, target), behavior });
    },
    [nowLineTopPx],
  );

  const scrollToNowRef = useRef(scrollToNowCentered);
  scrollToNowRef.current = scrollToNowCentered;

  const bindScrollRef = (node: HTMLDivElement | null) => {
    scrollRef.current = node;
    registerDayScrollRef(node);
  };

  const shouldCenterNow = centerNowInView && isToday && isExpanded;

  useEffect(() => {
    initialScrollRef.current = false;
  }, [ymd, gridStartMin, gridEndMin]);

  useEffect(() => {
    if (!isExpanded) {
      initialScrollRef.current = false;
      return;
    }
    if (!showNowByWallClock || nowLineTopPx == null) return;
    if (initialScrollRef.current) return;
    initialScrollRef.current = true;
    const run = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scrollToNowRef.current(shouldCenterNow ? "auto" : "smooth"),
        ),
      );
    const t = window.setTimeout(run, 120);
    return () => clearTimeout(t);
  }, [isExpanded, ymd, showNowByWallClock, nowLineTopPx, shouldCenterNow]);

  useEffect(() => {
    if (!shouldCenterNow || nowLineTopPx == null) return;
    const t = window.setTimeout(() => scrollToNowRef.current("smooth"), 80);
    return () => clearTimeout(t);
  }, [shouldCenterNow, nowLineTopPx, nowTick]);

  const handleScrollAreaScroll = useCallback(() => {
    if (weekAccordion) {
      onWeekScreenActivity?.();
      return;
    }
    if (centerNowInView && isToday) return;
    if (!isToday) return;
    if (Date.now() < ignoreScrollUntilRef.current) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      scrollToNowRef.current("smooth");
      idleTimerRef.current = null;
    }, SCROLL_IDLE_MS);
  }, [weekAccordion, onWeekScreenActivity, isToday, centerNowInView]);

  return (
    <section
      className={`border-b border-zinc-100 transition-all duration-500 last:border-b-0 dark:border-zinc-800 ${
        isToday ? "calendar-day-is-today" : ""
      }`}
    >
      <header
        role={weekAccordion ? "button" : undefined}
        tabIndex={weekAccordion ? 0 : undefined}
        aria-expanded={weekAccordion ? isExpanded : undefined}
        onClick={() => weekAccordion && onToggleDay()}
        onKeyDown={(e) => {
          if (!weekAccordion) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleDay();
          }
        }}
        className={`calendar-day-header sticky top-0 z-20 flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold backdrop-blur transition-colors duration-300 dark:border-zinc-700 ${
          isToday ? "calendar-day-header--today" : "calendar-day-header--default"
        } ${weekAccordion ? "cursor-pointer select-none hover:opacity-95" : ""}`}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <span className={isToday ? "inline-flex items-center gap-2" : ""}>
            {formatDayTitle(ymd)}
            {isToday && <span className="calendar-today-badge">{todayBadgeLabel}</span>}
          </span>
          <span className="calendar-day-subdate font-normal tabular-nums">{ymd}</span>
        </div>
        {weekAccordion && (
          <ChevronRight
            className={`h-5 w-5 shrink-0 transition-transform duration-200 calendar-accordion-chevron ${
              isExpanded ? "rotate-90" : dir === "rtl" ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        )}
      </header>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={bindScrollRef}
            className="flex max-h-[min(85vh,1800px)] scroll-smooth overflow-auto"
            dir={dir}
            onScroll={handleScrollAreaScroll}
          >
        <div
          className="sticky start-0 z-10 shrink-0 border-e border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"
          style={{ width: 56 }}
          dir="ltr"
        >
          <div style={{ height: SCHED_COL_HEAD_PX }} className="border-b border-zinc-200 dark:border-zinc-700" />
          {timeAxisSlots.map((slot) => (
            <div
              key={slot.key}
              className="border-b border-zinc-100 text-end text-xs font-semibold tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
              style={{ height: slot.heightPx }}
            >
              <span className="inline-block translate-y-[-0.35rem] pe-1 pt-0">{slot.label}</span>
            </div>
          ))}
        </div>

        <div className="relative flex min-w-0 flex-1">
          {nowLineTopPx != null && (
            <div
              className="staff-schedule-now-line pointer-events-none absolute start-0 end-0 z-[25]"
              style={{ top: SCHED_COL_HEAD_PX + nowLineTopPx }}
              aria-hidden
            />
          )}
          <div className="flex min-w-0 flex-1">
            {staff.map((s) => (
              <StaffDayColumn
                key={`${ymd}-${s.id}`}
                ymd={ymd}
                zone={zone}
                staff={s}
                gridStartMin={gridStartMin}
                gridEndMin={gridEndMin}
                gridHeightPx={gridHeightPx}
                pxPerMinute={pxPerMinute}
                gridMinutes={gridMinutes}
                appointments={appointmentsByDayStaff.get(`${ymd}|${s.id}`) ?? []}
                overlays={overlays.filter((o) => o.staffId === s.id)}
                overlayBreakTitle={overlayBreakTitle}
                overlayTimeBlockTitle={overlayTimeBlockTitle}
                overlayVacationTitle={overlayVacationTitle}
                onInteractionBlocked={onInteractionBlocked}
                customerName={customerName}
                formatServiceLine={formatServiceLine}
                canEdit={canEdit}
                onAppointmentClick={onAppointmentClick}
                onEmptyClick={onEmptyClick}
                onAppointmentPatch={onAppointmentPatch}
                draggingId={draggingId}
                setDraggingId={setDraggingId}
                minServiceMinutes={minServiceMinutes}
                debugGapHighlight={debugGapHighlight}
                snapToStepMinutes={snapToStepMinutes}
                visualVariant={visualVariant}
              />
            ))}
          </div>
        </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function expandedYmdFromWeekState(state: WeekPanelState, todayYmd: string): string | null {
  if (state === "NONE") return null;
  if (state === "DEFAULT") return todayYmd;
  return state;
}

export function StaffScheduleCalendar({
  businessTimeZone: zone,
  dates,
  staff,
  appointments,
  overlays = [],
  gridStartHour = DEFAULT_GRID_START,
  gridEndHour = DEFAULT_GRID_END,
  gridDayRange = null,
  pxPerMinute = DEFAULT_PX_PER_MIN,
  locale,
  customerName,
  formatServiceLine,
  minServiceMinutes = 15,
  debugGapHighlight = false,
  overlayBreakTitle = "Break",
  overlayTimeBlockTitle = "Blocked time",
  overlayVacationTitle = "Vacation",
  onInteractionBlocked,
  canEdit,
  onAppointmentClick,
  onEmptyClick,
  onAppointmentPatch,
  todayBadgeLabel,
  weekAccordion = false,
  snapToStepMinutes = SNAP_MIN,
  visualVariant = "default",
  centerNowInView = false,
}: StaffScheduleCalendarProps) {
  const gridStartMin = gridDayRange?.startMin ?? gridStartHour * 60;
  const gridEndMin = gridDayRange?.endMin ?? gridEndHour * 60;
  const gridMinutes = Math.max(15, gridEndMin - gridStartMin);
  const gridHeightPx = gridMinutes * pxPerMinute;
  const dir = locale === "he" || locale === "ar" ? "rtl" : "ltr";

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [weekPanelState, setWeekPanelState] = useState<WeekPanelState>("DEFAULT");
  const scrollByYmd = useRef<Record<string, HTMLDivElement | null>>({});
  const datesKey = useMemo(() => dates.join(","), [dates]);
  const datesRef = useRef(dates);
  datesRef.current = dates;
  const weekIdleBumpRef = useRef<() => void>(() => {});

  const zonedNow = nowInScheduleZone(zone);
  const todayYmd = zonedNow.toISODate()!;

  useEffect(() => {
    setWeekPanelState("DEFAULT");
  }, [datesKey]);

  const expandedYmd = weekAccordion ? expandedYmdFromWeekState(weekPanelState, todayYmd) : null;

  const expandedYmdResolved = useMemo(() => {
    if (!weekAccordion) return null;
    if (expandedYmd == null) return null;
    const d = datesRef.current;
    if (d.includes(expandedYmd)) return expandedYmd;
    return d[0] ?? null;
  }, [weekAccordion, expandedYmd, datesKey]);

  const toggleWeekDay = useCallback(
    (ymd: string) => {
      if (!weekAccordion) return;
      setWeekPanelState((prev) => {
        const open = expandedYmdFromWeekState(prev, todayYmd);
        const d = datesRef.current;
        const resolved = open != null ? (d.includes(open) ? open : d[0] ?? null) : null;
        if (resolved === ymd) return "NONE";
        return ymd;
      });
    },
    [weekAccordion, todayYmd],
  );

  const registerDayScroll = useCallback((ymd: string) => {
    return (el: HTMLDivElement | null) => {
      scrollByYmd.current[ymd] = el;
    };
  }, []);

  const scrollPanelToNow = useCallback(
    (ymd: string) => {
      const el = scrollByYmd.current[ymd];
      if (!el) return;
      const now = nowInScheduleZone(zone);
      if (!now.isValid) return;
      const mins = now.hour * 60 + now.minute + now.second / 60;
      const g0 = gridStartMin;
      const g1 = gridEndMin;
      if (mins < g0 || mins > g1) return;
      const nowLineTopPx = (mins - g0) * pxPerMinute;
      const target = SCHED_COL_HEAD_PX + nowLineTopPx - el.clientHeight / 2;
      el.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    },
    [zone, gridStartMin, gridEndMin, pxPerMinute],
  );

  useEffect(() => {
    if (!weekAccordion) {
      weekIdleBumpRef.current = () => {};
      return;
    }
    let idleTimer: number | null = null;
    const bump = () => {
      if (idleTimer != null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        setWeekPanelState("DEFAULT");
        window.setTimeout(() => {
          const d = datesRef.current;
          const raw = expandedYmdFromWeekState("DEFAULT", todayYmd);
          const targetYmd = raw != null && d.includes(raw) ? raw : d[0];
          if (targetYmd) scrollPanelToNow(targetYmd);
        }, 400);
        idleTimer = null;
      }, SCROLL_IDLE_MS);
    };
    weekIdleBumpRef.current = bump;
    bump();
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", bump, opts);
    window.addEventListener("pointermove", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    window.addEventListener("touchmove", bump, opts);
    window.addEventListener("wheel", bump, opts);
    window.addEventListener("keydown", bump);
    return () => {
      weekIdleBumpRef.current = () => {};
      if (idleTimer != null) window.clearTimeout(idleTimer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("touchstart", bump);
      window.removeEventListener("touchmove", bump);
      window.removeEventListener("wheel", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [weekAccordion, todayYmd, scrollPanelToNow, datesKey]);

  const appointmentsByDayStaff = useMemo(() => {
    const key = (ymd: string, staffId: string) => `${ymd}|${staffId}`;
    const map = new Map<string, ScheduleCalendarAppointment[]>();
    for (const a of appointments) {
      if (["CANCELLED", "NO_SHOW"].includes(a.status)) continue;
      const ymd = businessLocalYmdFromIso(a.startTime, zone);
      const sid = a.staff?.id;
      if (!sid) continue;
      const k = key(ymd, sid);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [appointments, zone]);

  const formatDayTitle = (ymd: string) => {
    const d = DateTime.fromISO(ymd, { zone });
    return d.setLocale(locale === "he" ? "he" : locale === "ar" ? "ar" : "en").toFormat("EEE d MMM");
  };

  return (
    <div
      className="staff-schedule-calendar staff-schedule-calendar-enter rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      dir={dir}
    >
      {dates.map((ymd) => {
        const isDayExpanded = !weekAccordion || expandedYmdResolved === ymd;
        return (
          <ScheduleDaySection
            key={ymd}
            ymd={ymd}
            zone={zone}
            todayBadgeLabel={todayBadgeLabel}
            isToday={ymd === todayYmd}
            formatDayTitle={formatDayTitle}
            gridStartMin={gridStartMin}
            gridEndMin={gridEndMin}
            pxPerMinute={pxPerMinute}
            gridHeightPx={gridHeightPx}
            gridMinutes={gridMinutes}
            dir={dir}
            staff={staff}
            appointmentsByDayStaff={appointmentsByDayStaff}
            overlays={overlays}
            overlayBreakTitle={overlayBreakTitle}
            overlayTimeBlockTitle={overlayTimeBlockTitle}
            overlayVacationTitle={overlayVacationTitle}
            onInteractionBlocked={onInteractionBlocked}
            customerName={customerName}
            formatServiceLine={formatServiceLine}
            canEdit={canEdit}
            onAppointmentClick={onAppointmentClick}
            onEmptyClick={onEmptyClick}
            onAppointmentPatch={onAppointmentPatch}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
            minServiceMinutes={minServiceMinutes}
            debugGapHighlight={debugGapHighlight}
            weekAccordion={weekAccordion}
            isExpanded={isDayExpanded}
            onToggleDay={() => toggleWeekDay(ymd)}
            registerDayScrollRef={registerDayScroll(ymd)}
            onWeekScreenActivity={
              weekAccordion ? () => weekIdleBumpRef.current() : undefined
            }
            snapToStepMinutes={snapToStepMinutes}
            visualVariant={visualVariant}
            centerNowInView={centerNowInView}
          />
        );
      })}
    </div>
  );
}

type ColumnProps = {
  ymd: string;
  zone: string;
  staff: StaffScheduleRow;
  gridStartMin: number;
  gridEndMin: number;
  gridHeightPx: number;
  pxPerMinute: number;
  gridMinutes: number;
  appointments: ScheduleCalendarAppointment[];
  overlays: ScheduleOverlay[];
  overlayBreakTitle: string;
  overlayTimeBlockTitle: string;
  overlayVacationTitle: string;
  onInteractionBlocked?: (reason: "click" | "drag") => void;
  customerName: (c: ScheduleCalendarAppointment["customer"]) => string;
  formatServiceLine?: (a: ScheduleCalendarAppointment) => string;
  canEdit: boolean;
  onAppointmentClick: (a: ScheduleCalendarAppointment) => void;
  onEmptyClick?: (ymd: string, staffId: string, minutesFromMidnight: number) => void;
  onAppointmentPatch?: (
    appointmentId: string,
    staffId: string,
    startIso: string,
    endIso: string,
  ) => Promise<void>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  minServiceMinutes: number;
  debugGapHighlight: boolean;
  snapToStepMinutes: number;
  visualVariant: "default" | "premium";
};

function StaffDayColumn({
  ymd,
  zone,
  staff: s,
  gridStartMin,
  gridEndMin,
  gridHeightPx,
  pxPerMinute,
  gridMinutes,
  appointments,
  overlays,
  overlayBreakTitle,
  overlayTimeBlockTitle,
  overlayVacationTitle,
  onInteractionBlocked,
  customerName,
  formatServiceLine,
  canEdit,
  onAppointmentClick,
  onEmptyClick,
  onAppointmentPatch,
  draggingId,
  setDraggingId,
  minServiceMinutes,
  debugGapHighlight,
  snapToStepMinutes,
  visualVariant,
}: ColumnProps) {
  const band = workingBand(ymd, zone, s, gridStartMin, gridEndMin);
  const notifyOverlayClick = Boolean(onEmptyClick && onInteractionBlocked);

  const dragBlockers = useMemo(() => {
    const ranges: { start: number; end: number }[] = [];
    for (const o of overlays) {
      const vis = visibleSegmentMinutes(o.startTime, o.endTime, ymd, zone, gridStartMin, gridEndMin);
      if (!vis) continue;
      ranges.push({ start: vis.startMinDay, end: vis.endMinDay });
    }
    return ranges;
  }, [overlays, ymd, zone, gridStartMin, gridEndMin]);

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    if (!onEmptyClick) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesInGrid = y / pxPerMinute;
    const minutesFromMidnight = gridStartMin + snapToStep(minutesInGrid, snapToStepMinutes);
    if (minutesFromMidnight >= gridEndMin) return;
    for (const r of dragBlockers) {
      if (minutesFromMidnight >= r.start && minutesFromMidnight < r.end) {
        onInteractionBlocked?.("click");
        return;
      }
    }
    onEmptyClick(ymd, s.id, minutesFromMidnight);
  };

  const gapMarkers = useMemo(() => {
    if (!debugGapHighlight || !band) return [];
    const grid0 = gridStartMin;
    const segs = appointments
      .map((a) => {
        const vis = visibleSegmentMinutes(a.startTime, a.endTime, ymd, zone, gridStartMin, gridEndMin);
        if (!vis) return null;
        return { a0: vis.startMinDay, a1: vis.endMinDay };
      })
      .filter(Boolean) as { a0: number; a1: number }[];
    segs.sort((x, y) => x.a0 - y.a0);
    const whStart = grid0 + band.topMin;
    const whEnd = whStart + band.heightMin;
    const markers: { topPx: number; heightPx: number }[] = [];
    let cursor = whStart;
    for (const seg of segs) {
      const gap = seg.a0 - cursor;
      if (gap > 0 && gap < minServiceMinutes) {
        const topMin = cursor - grid0;
        markers.push({ topPx: topMin * pxPerMinute, heightPx: gap * pxPerMinute });
      }
      cursor = Math.max(cursor, seg.a1);
    }
    const tail = whEnd - cursor;
    if (tail > 0 && tail < minServiceMinutes) {
      const topMin = cursor - grid0;
      markers.push({ topPx: topMin * pxPerMinute, heightPx: tail * pxPerMinute });
    }
    return markers;
  }, [debugGapHighlight, band, appointments, ymd, zone, gridStartMin, gridEndMin, minServiceMinutes, pxPerMinute]);

  return (
    <div
      className="relative min-w-[160px] flex-1 border-e border-zinc-100 last:border-e-0 dark:border-zinc-800"
      style={{ minHeight: gridHeightPx + SCHED_COL_HEAD_PX }}
    >
      <div
        className="sticky top-0 z-[15] truncate border-b border-zinc-200 bg-white/95 px-2 py-2 text-center text-xs font-medium backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
        style={{ minHeight: SCHED_COL_HEAD_PX }}
      >
        {s.firstName} {s.lastName}
      </div>

      <div
        className="relative bg-zinc-100/40 dark:bg-zinc-800/40"
        style={{ height: gridHeightPx }}
        onPointerDown={handleBackgroundPointerDown}
      >
        {band && (
          <div
            className="pointer-events-none absolute inset-x-0 z-0 bg-emerald-500/[0.07] dark:bg-emerald-400/[0.09]"
            style={{
              top: band.topMin * pxPerMinute,
              height: band.heightMin * pxPerMinute,
            }}
          />
        )}

        {Array.from({ length: Math.floor(gridMinutes / 15) + 1 }, (_, i) => (
          <div
            key={i}
            className={`pointer-events-none absolute inset-x-0 border-b ${
              i % 4 === 0 ? "border-zinc-300/80 dark:border-zinc-600/80" : "border-zinc-200/50 border-dashed dark:border-zinc-700/50"
            }`}
            style={{ top: i * 15 * pxPerMinute }}
          />
        ))}

        {gapMarkers.map((g, i) => (
          <div
            key={`gap-${i}`}
            className="pointer-events-none absolute inset-x-1 z-[5] rounded-sm bg-red-500/25 ring-1 ring-red-500/50"
            style={{ top: g.topPx, height: Math.max(g.heightPx, 2) }}
            title={`Gap &lt; ${minServiceMinutes} min`}
          />
        ))}

        {overlays.map((o) => {
          const vis = visibleSegmentMinutes(o.startTime, o.endTime, ymd, zone, gridStartMin, gridEndMin);
          if (!vis) return null;
          const isVac = o.variant === "vacation";
          const isTimeBlock = o.variant === "time_block";
          const heightPx = Math.max(vis.heightMin * pxPerMinute, isVac ? 6 : 22);
          const label = isVac ? overlayVacationTitle : isTimeBlock ? overlayTimeBlockTitle : overlayBreakTitle;
          const ringBg =
            isVac
              ? "bg-amber-400/35 ring-amber-600/70 dark:bg-amber-500/25 dark:ring-amber-400/60"
              : isTimeBlock
                ? "bg-zinc-400/25 ring-zinc-500/75 dark:bg-zinc-600/35 dark:ring-zinc-400/65"
                : "ring-orange-600/75 dark:ring-orange-400/70";
          const stripe =
            isVac
              ? "repeating-linear-gradient(135deg, rgb(251 191 36 / 0.4) 0, rgb(251 191 36 / 0.4) 8px, rgb(254 243 199 / 0.45) 8px, rgb(254 243 199 / 0.45) 16px)"
              : isTimeBlock
                ? "repeating-linear-gradient(-45deg, rgb(113 113 122 / 0.35) 0, rgb(113 113 122 / 0.35) 7px, rgb(228 228 231 / 0.55) 7px, rgb(228 228 231 / 0.55) 14px)"
                : "repeating-linear-gradient(-45deg, rgb(234 88 12 / 0.38) 0, rgb(234 88 12 / 0.38) 7px, rgb(254 215 170 / 0.5) 7px, rgb(254 215 170 / 0.5) 14px)";
          return (
            <div
              key={o.id}
              role="presentation"
              title={label}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (notifyOverlayClick) onInteractionBlocked?.("click");
              }}
              className={`absolute inset-x-0.5 z-[8] cursor-not-allowed rounded-md ring-2 ${ringBg}`}
              style={{
                top: vis.topMin * pxPerMinute,
                height: heightPx,
                backgroundImage: stripe,
              }}
            >
              {!isVac && (
                <span
                  className={`pointer-events-none flex h-full min-h-[20px] items-start justify-center truncate px-1 pt-0.5 text-center text-[10px] font-bold uppercase leading-tight tracking-wide ${
                    isTimeBlock
                      ? "text-zinc-800 dark:text-zinc-100"
                      : "text-orange-950/90 dark:text-orange-100"
                  }`}
                >
                  {label}
                </span>
              )}
              {isVac && heightPx >= 20 && (
                <span className="pointer-events-none block truncate px-1.5 pt-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-amber-950/90 dark:text-amber-100">
                  {label}
                </span>
              )}
            </div>
          );
        })}

        {appointments.map((apt) => {
          const vis = visibleSegmentMinutes(apt.startTime, apt.endTime, ymd, zone, gridStartMin, gridEndMin);
          if (!vis) return null;
          return (
            <BookingBlock
              key={apt.id}
              appointment={apt}
              ymd={ymd}
              zone={zone}
              topPx={vis.topMin * pxPerMinute}
              heightPx={Math.max(vis.heightMin * pxPerMinute, 20)}
              startMinDay={vis.startMinDay}
              endMinDay={vis.endMinDay}
              gridStartMin={gridStartMin}
              gridEndMin={gridEndMin}
              dragBlockers={dragBlockers}
              onInteractionBlocked={onInteractionBlocked}
              customerName={customerName}
              formatServiceLine={formatServiceLine}
              canEdit={canEdit}
              onAppointmentClick={onAppointmentClick}
              onAppointmentPatch={onAppointmentPatch}
              staffId={s.id}
              pxPerMinute={pxPerMinute}
              gridMaxHeightPx={gridHeightPx}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              snapToStepMinutes={snapToStepMinutes}
              visualVariant={visualVariant}
            />
          );
        })}
      </div>
    </div>
  );
}

type BlockProps = {
  appointment: ScheduleCalendarAppointment;
  ymd: string;
  zone: string;
  topPx: number;
  heightPx: number;
  startMinDay: number;
  endMinDay: number;
  gridStartMin: number;
  gridEndMin: number;
  dragBlockers: { start: number; end: number }[];
  onInteractionBlocked?: (reason: "click" | "drag") => void;
  customerName: (c: ScheduleCalendarAppointment["customer"]) => string;
  formatServiceLine?: (a: ScheduleCalendarAppointment) => string;
  canEdit: boolean;
  onAppointmentClick: (a: ScheduleCalendarAppointment) => void;
  onAppointmentPatch?: (
    appointmentId: string,
    staffId: string,
    startIso: string,
    endIso: string,
  ) => Promise<void>;
  staffId: string;
  pxPerMinute: number;
  gridMaxHeightPx: number;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  snapToStepMinutes: number;
  visualVariant: "default" | "premium";
};

function BookingBlock({
  appointment: apt,
  ymd,
  zone,
  topPx: initialTop,
  heightPx: initialHeight,
  startMinDay,
  endMinDay,
  gridStartMin,
  gridEndMin,
  dragBlockers,
  onInteractionBlocked,
  customerName,
  formatServiceLine,
  canEdit,
  onAppointmentClick,
  onAppointmentPatch,
  staffId,
  pxPerMinute,
  gridMaxHeightPx,
  draggingId,
  setDraggingId,
  snapToStepMinutes,
  visualVariant,
}: BlockProps) {
  const color = resolveCustomerEventColor(apt.customer?.id ?? apt.id, apt.customer?.tagColor);
  const accent = appointmentStatusAccent(apt.status, color);
  const [topPx, setTopPx] = useState(initialTop);
  const [heightPx, setHeightPx] = useState(initialHeight);
  const liveRef = useRef({ top: initialTop, h: initialHeight });
  liveRef.current = { top: topPx, h: heightPx };

  useEffect(() => {
    if (draggingId !== apt.id) {
      setTopPx(initialTop);
      setHeightPx(initialHeight);
    }
  }, [initialTop, initialHeight, apt.id, draggingId]);

  const dragSession = useRef<{
    kind: "move" | "resize";
    startY: number;
    origTop: number;
    origH: number;
    origStart: number;
    origEnd: number;
    moved: boolean;
  } | null>(null);

  const overlapsBreak = (rangeStart: number, rangeEnd: number) =>
    dragBlockers.some((b) => rangesOverlapHalfOpen(rangeStart, rangeEnd, b.start, b.end));

  const endDrag = (
    d: NonNullable<typeof dragSession.current>,
    patch: typeof onAppointmentPatch,
  ) => {
    const grid0 = gridStartMin;
    const grid1 = gridEndMin;
    const { top, h } = liveRef.current;
    const duration = d.origEnd - d.origStart;

    if (d.kind === "move") {
      const deltaMinRaw = (top - d.origTop) / pxPerMinute;
      const deltaMin = snapToStep(deltaMinRaw, snapToStepMinutes);
      let newStart = d.origStart + deltaMin;
      let newEnd = newStart + duration;
      newStart = snapToStep(newStart, snapToStepMinutes);
      newEnd = snapToStep(newEnd, snapToStepMinutes);
      if (newStart < grid0) {
        newStart = grid0;
        newEnd = newStart + duration;
      }
      if (newEnd > grid1) {
        newEnd = grid1;
        newStart = newEnd - duration;
      }
      if (newEnd - newStart < snapToStepMinutes || newStart < 0) {
        setTopPx(initialTop);
        setHeightPx(initialHeight);
        return;
      }
      if (overlapsBreak(newStart, newEnd)) {
        setTopPx(initialTop);
        setHeightPx(initialHeight);
        onInteractionBlocked?.("drag");
        return;
      }
      if (newStart === d.origStart && newEnd === d.origEnd) return;
      if (!patch) return;
      void patch(apt.id, staffId, wallTimeToUtcIso(ymd, zone, newStart), wallTimeToUtcIso(ymd, zone, newEnd)).catch(() => {
        setTopPx(initialTop);
        setHeightPx(initialHeight);
      });
      return;
    }

    const durMin = Math.max(snapToStepMinutes, snapToStep(h / pxPerMinute, snapToStepMinutes));
    let newEnd = d.origStart + durMin;
    newEnd = Math.min(newEnd, grid1);
    if (newEnd - d.origStart < snapToStepMinutes) {
      setTopPx(initialTop);
      setHeightPx(initialHeight);
      return;
    }
    if (overlapsBreak(d.origStart, newEnd)) {
      setTopPx(initialTop);
      setHeightPx(initialHeight);
      onInteractionBlocked?.("drag");
      return;
    }
    if (newEnd === d.origEnd) return;
    if (!patch) return;
    void patch(apt.id, staffId, wallTimeToUtcIso(ymd, zone, d.origStart), wallTimeToUtcIso(ymd, zone, newEnd)).catch(() => {
      setTopPx(initialTop);
      setHeightPx(initialHeight);
    });
  };

  const suppressClickRef = useRef(false);

  const attachDragListeners = (d: NonNullable<typeof dragSession.current>) => {
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - d.startY;
      if (d.kind === "move") {
        if (Math.abs(dy) > 2) d.moved = true;
        const next = Math.max(0, Math.min(d.origTop + dy, gridMaxHeightPx - d.origH));
        setTopPx(next);
      } else {
        if (dy !== 0) d.moved = true;
        setHeightPx(Math.max(pxPerMinute * snapToStepMinutes, d.origH + dy));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const cur = dragSession.current;
      dragSession.current = null;
      setDraggingId(null);
      if (!cur || !cur.moved) return;
      suppressClickRef.current = true;
      endDrag(cur, onAppointmentPatch);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onPointerDownMove = (e: React.PointerEvent) => {
    if (!canEdit || !onAppointmentPatch) return;
    e.stopPropagation();
    e.preventDefault();
    setDraggingId(apt.id);
    const d = {
      kind: "move" as const,
      startY: e.clientY,
      origTop: topPx,
      origH: heightPx,
      origStart: startMinDay,
      origEnd: endMinDay,
      moved: false,
    };
    dragSession.current = d;
    attachDragListeners(d);
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (!canEdit || !onAppointmentPatch) return;
    e.stopPropagation();
    e.preventDefault();
    setDraggingId(apt.id);
    const d = {
      kind: "resize" as const,
      startY: e.clientY,
      origTop: topPx,
      origH: heightPx,
      origStart: startMinDay,
      origEnd: endMinDay,
      moved: false,
    };
    dragSession.current = d;
    attachDragListeners(d);
  };

  const premium = visualVariant === "premium";

  return (
    <div
      className={`staff-schedule-booking-enter absolute inset-x-1 z-10 cursor-grab overflow-hidden active:cursor-grabbing ${
        premium
          ? "rounded-xl border border-zinc-200/70 shadow-md ring-1 ring-black/5 transition-[transform,box-shadow] duration-200 ease-out hover:z-[19] hover:scale-[1.012] hover:shadow-lg dark:border-zinc-600/50 dark:ring-white/10"
          : "rounded-lg border-2 shadow-sm dark:shadow-md"
      }`}
      style={{
        top: topPx,
        height: heightPx,
        borderColor: premium ? undefined : color,
        borderInlineStartWidth: premium ? 5 : undefined,
        borderInlineStartStyle: premium ? "solid" : undefined,
        borderInlineStartColor: premium ? accent : undefined,
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} ${premium ? "18" : "14"}%, white) 0%, color-mix(in srgb, ${color} ${premium ? "10" : "7"}%, white) 100%)`,
      }}
    >
      <button
        type="button"
        className="flex h-full w-full flex-col gap-0.5 px-2 py-1 text-start text-zinc-900 dark:text-zinc-100"
        onPointerDown={onPointerDownMove}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onAppointmentClick(apt);
        }}
      >
        <span className="text-[10px] font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
          {formatHhMmInZone(apt.startTime, zone)} – {formatHhMmInZone(apt.endTime, zone)}
        </span>
        <span className="truncate text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
          <span className="font-semibold">{customerName(apt.customer)}</span>
          <span className="text-zinc-600 dark:text-zinc-400">
            {" · "}
            {formatServiceLine ? formatServiceLine(apt) : apt.service?.name ?? "—"}
          </span>
        </span>
      </button>
      {canEdit && onAppointmentPatch && (
        <div
          className="absolute bottom-0 start-0 end-0 z-20 cursor-ns-resize"
          style={{ height: RESIZE_HANDLE_PX }}
          onPointerDown={onPointerDownResize}
          aria-label="Resize"
        />
      )}
    </div>
  );
}
