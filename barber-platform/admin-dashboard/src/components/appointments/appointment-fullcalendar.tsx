"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventChangeArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import { DateTime } from "luxon";
import { apiAppointmentRangeForCalendar } from "@/lib/appointment-calendar-time";
import { resolveCustomerEventColor } from "@/lib/customer-tag-colors";

/** FullCalendar Premium license key */
const SCHEDULER_LICENSE_KEY = "0375688681-fcs-1773907671";

export type AppointmentEvent = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff: { id: string; firstName: string; lastName: string };
  service: { id: string; name: string; durationMinutes: number };
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    tagColor?: string | null;
  };
};

export type BreakWithStaff = {
  staffId: string;
  id: string;
  startTime: string;
  endTime: string;
};

export type VacationEvent = {
  id: string;
  staff: { id: string; firstName: string; lastName: string };
  startDate: string;
  endDate: string;
};

type AppointmentFullCalendarProps = {
  appointments: AppointmentEvent[];
  staffList: { id: string; firstName: string; lastName: string }[];
  breaksWithStaff: BreakWithStaff[];
  vacations: VacationEvent[];
  staffFilter: string;
  initialDate: Date;
  initialView: "resourceTimeGridDay" | "resourceTimeGridWeek";
  locale: string;
  customerName: (c: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
  }) => string;
  /** i18n: "Break" / استراحة / הפסקה */
  breakLabel: string;
  vacationLabel: string;
  onAppointmentClick: (apt: AppointmentEvent) => void;
  onDateClick?: (date: Date, resourceId?: string) => void;
  onNavigate?: (date: Date) => void;
  onEventDrop?: (aptId: string, staffId: string, startTime: string, endTime: string) => Promise<void>;
  onEventResize?: (aptId: string, staffId: string, startTime: string, endTime: string) => Promise<void>;
  /** IANA zone for vacation spans, “today” line, and FullCalendar `timeZone`. */
  calendarTimeZone?: string;
};

function formatDate(d: Date, zone: string) {
  return DateTime.fromJSDate(d).setZone(zone).toISODate() ?? "";
}

export function AppointmentFullCalendar({
  appointments,
  staffList,
  breaksWithStaff,
  vacations,
  staffFilter,
  initialDate,
  initialView,
  locale,
  customerName,
  breakLabel,
  vacationLabel,
  onAppointmentClick,
  onDateClick,
  onNavigate,
  onEventDrop,
  onEventResize,
  calendarTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: AppointmentFullCalendarProps) {
  const tz = calendarTimeZone;
  const calendarRef = useRef<FullCalendar>(null);
  const appointmentMap = useRef<Map<string, AppointmentEvent>>(new Map());

  const resources = staffFilter
    ? staffList.filter((s) => s.id === staffFilter)
    : staffList;

  const events: EventInput[] = useMemo(() => {
    const out: EventInput[] = [];
    const aptMap = new Map<string, AppointmentEvent>();

    for (const apt of appointments) {
      aptMap.set(apt.id, apt);
      const customerColor = resolveCustomerEventColor(
        apt.customer?.id ?? apt.id,
        apt.customer?.tagColor,
      );
      // UTC instant → ISO בעסק (`calendarTimeZone` מה-API). דיבוג: NEXT_PUBLIC_APPOINTMENT_CALENDAR_DEBUG=1
      const { start: calStart, end: calEnd } = apiAppointmentRangeForCalendar(
        apt.startTime,
        apt.endTime,
        tz,
      );
      out.push({
        id: apt.id,
        resourceId: apt.staff?.id,
        title: customerName(apt.customer),
        start: calStart,
        end: calEnd,
        extendedProps: {
          type: "appointment",
          appointment: apt,
          serviceName: apt.service?.name ?? "—",
          customerColor,
        },
        backgroundColor: "#f8fafc",
        borderColor: customerColor,
        classNames: ["fc-appointment-event"],
      });
    }

    for (const br of breaksWithStaff) {
      const { start: brStart, end: brEnd } = apiAppointmentRangeForCalendar(
        br.startTime,
        br.endTime,
        tz,
      );
      out.push({
        id: br.id,
        resourceId: br.staffId,
        title: breakLabel,
        start: brStart,
        end: brEnd,
        extendedProps: { type: "break" },
        classNames: ["fc-break-event"],
        startEditable: false,
        durationEditable: false,
      });
    }

    let rangeStartDt = DateTime.fromJSDate(initialDate).setZone(tz).startOf("day");
    let rangeEndDt = rangeStartDt;
    if (initialView === "resourceTimeGridDay") {
      rangeEndDt = rangeStartDt.plus({ days: 1 });
    } else {
      const daysSinceSun = rangeStartDt.weekday % 7;
      rangeStartDt = rangeStartDt.minus({ days: daysSinceSun });
      rangeEndDt = rangeStartDt.plus({ days: 7 });
    }
    const rangeStart = rangeStartDt.toISODate() ?? "";
    const rangeEnd = rangeEndDt.toISODate() ?? "";

    const visibleStaffIds = new Set(resources.map((r) => r.id));
    for (const v of vacations) {
      if (!visibleStaffIds.has(v.staff.id)) continue;
      const vStart = DateTime.fromISO(v.startDate, { zone: tz }).startOf("day");
      const vEnd = DateTime.fromISO(v.endDate, { zone: tz }).endOf("day");
      const rangeStartLuxon = DateTime.fromISO(rangeStart, { zone: tz }).startOf("day");
      const rangeEndLuxon = DateTime.fromISO(rangeEnd, { zone: tz }).endOf("day");
      let cursor = DateTime.max(vStart, rangeStartLuxon);
      while (cursor <= vEnd && cursor <= rangeEndLuxon) {
        const dateStr = cursor.toISODate() ?? "";
        if (dateStr >= rangeStart && dateStr <= rangeEnd) {
          out.push({
            id: `vacation-${v.id}-${dateStr}`,
            resourceId: v.staff.id,
            title: `${v.staff.firstName} ${v.staff.lastName} – ${vacationLabel}`,
            start: `${dateStr}T08:00:00`,
            end: `${dateStr}T22:00:00`,
            extendedProps: { type: "vacation" },
            classNames: ["fc-vacation-event"],
            startEditable: false,
            durationEditable: false,
          });
        }
        cursor = cursor.plus({ days: 1 });
      }
    }

    appointmentMap.current = aptMap;
    return out;
  }, [
    appointments,
    breaksWithStaff,
    vacations,
    initialDate,
    initialView,
    locale,
    customerName,
    breakLabel,
    vacationLabel,
    tz,
  ]);

  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      info.jsEvent.preventDefault();
      const type = info.event.extendedProps?.type;
      if (type === "appointment") {
        const apt = info.event.extendedProps?.appointment as AppointmentEvent;
        if (apt) onAppointmentClick(apt);
      }
    },
    [onAppointmentClick]
  );

  const handleDateClick = useCallback(
    (info: DateClickArg) => {
      onDateClick?.(info.date, info.resource?.id);
    },
    [onDateClick]
  );

  const handleEventDrop = useCallback(
    async (arg: EventDropArg) => {
      const type = arg.event.extendedProps?.type;
      if (type !== "appointment" || !onEventDrop) {
        arg.revert();
        return;
      }
      const aptId = arg.event.id;
      const staffId = arg.event.getResources()[0]?.id ?? arg.event.extendedProps?.appointment?.staff?.id;
      if (!staffId) {
        arg.revert();
        return;
      }
      const start = arg.event.start!;
      const end = arg.event.end!;
      try {
        await onEventDrop(
          aptId,
          staffId,
          start.toISOString(),
          end.toISOString(),
        );
      } catch {
        arg.revert();
      }
    },
    [onEventDrop]
  );

  const handleEventResize = useCallback(
    async (arg: EventChangeArg) => {
      const type = arg.event.extendedProps?.type;
      if (type !== "appointment" || !onEventResize) {
        arg.revert();
        return;
      }
      const aptId = arg.event.id;
      const staffId = arg.event.getResources()[0]?.id ?? arg.event.extendedProps?.appointment?.staff?.id;
      if (!staffId) {
        arg.revert();
        return;
      }
      const start = arg.event.start!;
      const end = arg.event.end!;
      try {
        await onEventResize(
          aptId,
          staffId,
          start.toISOString(),
          end.toISOString(),
        );
      } catch {
        arg.revert();
      }
    },
    [onEventResize]
  );

  const lastDatesSetRef = useRef<string>("");
  const handleDatesSet = useCallback(
    (arg: { view: { currentStart: Date } }) => {
      const key = formatDate(arg.view.currentStart, tz);
      if (lastDatesSetRef.current === key) return;
      lastDatesSetRef.current = key;
      onNavigate?.(arg.view.currentStart);
    },
    [onNavigate, tz]
  );

  const eventContentRenderer = useCallback(
    (arg: {
      event: {
        title: string;
        extendedProps?: {
          type?: string;
          appointment?: AppointmentEvent;
          serviceName?: string;
        };
      };
      timeText: string;
    }) => {
      const type = arg.event.extendedProps?.type;
      if (type === "break") {
        return (
          <div className="fc-break-content flex h-full items-center justify-center gap-2 px-2">
            <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
              {breakLabel}
            </span>
            <span className="text-xs tabular-nums text-zinc-500">
              {arg.timeText}
            </span>
          </div>
        );
      }
      if (type === "vacation") {
        return (
          <div className="flex h-full items-center justify-center px-2">
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-100">
              {vacationLabel}
            </span>
          </div>
        );
      }
      const serviceName = arg.event.extendedProps?.serviceName ?? "—";
      return (
        <div className="fc-appointment-content flex h-full flex-col justify-center gap-0.5 px-2 py-1 text-right">
          <p className="text-xs tabular-nums opacity-90">{arg.timeText}</p>
          <p className="truncate font-semibold">{arg.event.title}</p>
          <p className="truncate text-xs opacity-90">{serviceName}</p>
        </div>
      );
    },
    [breakLabel, vacationLabel]
  );

  const isViewingToday =
    formatDate(initialDate, tz) === DateTime.now().setZone(tz).toISODate();
  useEffect(() => {
    lastDatesSetRef.current = formatDate(initialDate, tz);
    const api = calendarRef.current?.getApi();
    if (api) {
      api.gotoDate(initialDate);
    }
  }, [initialDate, tz]);
  useEffect(() => {
    if (!isViewingToday) return;
    const api = calendarRef.current?.getApi();
    if (api) {
      const timer = setTimeout(() => {
        const now = DateTime.now().setZone(tz);
        const msFromMidnight = now.diff(now.startOf("day"), "milliseconds").milliseconds;
        api.scrollToTime(msFromMidnight);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [initialDate, isViewingToday, tz]);

  return (
    <div className="appointment-fullcalendar rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <FullCalendar
        ref={calendarRef}
        schedulerLicenseKey={SCHEDULER_LICENSE_KEY}
        plugins={[timeGridPlugin, resourceTimeGridPlugin, interactionPlugin]}
        initialView={initialView}
        initialDate={initialDate}
        locale={locale === "he" ? "he" : "en-gb"}
        direction={locale === "he" ? "rtl" : "ltr"}
        timeZone={tz}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "",
        }}
        resources={resources.map((s) => ({
          id: s.id,
          title: `${s.firstName} ${s.lastName}`,
        }))}
        events={events}
        nowIndicator={true}
        slotDuration="00:05:00"
        slotLabelInterval="00:30:00"
        slotMinTime="08:00:00"
        slotMaxTime="22:00:00"
        eventMinHeight={36}
        selectable={true}
        selectMirror={true}
        selectLongPressDelay={0}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        datesSet={handleDatesSet}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        eventContent={eventContentRenderer}
        height="auto"
        expandRows={true}
        navLinks={true}
        editable={!!(onEventDrop || onEventResize)}
        eventStartEditable={!!onEventDrop}
        eventDurationEditable={!!onEventResize}
        dayMaxEvents={false}
        moreLinkClick="popover"
        eventDisplay="block"
      />
    </div>
  );
}
