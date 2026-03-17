"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";

/** Customer color palette - same customer gets same color */
const CUSTOMER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#14b8a6",
];

function getCustomerColor(customerId: string): string {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash << 5) - hash + customerId.charCodeAt(i);
  }
  const idx = Math.abs(hash) % CUSTOMER_COLORS.length;
  return CUSTOMER_COLORS[idx];
}

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
  customerName: (c: { firstName?: string | null; lastName?: string | null; email?: string }) => string;
  vacationLabel: string;
  onAppointmentClick: (apt: AppointmentEvent) => void;
  onDateClick?: (date: Date, resourceId?: string) => void;
  onNavigate?: (date: Date) => void;
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
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
  vacationLabel,
  onAppointmentClick,
  onDateClick,
  onNavigate,
}: AppointmentFullCalendarProps) {
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
      const customerColor = getCustomerColor(apt.customer?.id ?? apt.id);
      out.push({
        id: apt.id,
        resourceId: apt.staff?.id,
        title: customerName(apt.customer),
        start: apt.startTime,
        end: apt.endTime,
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
      out.push({
        id: br.id,
        resourceId: br.staffId,
        title: locale === "he" ? "הפסקה" : "Break",
        start: br.startTime,
        end: br.endTime,
        extendedProps: { type: "break" },
        classNames: ["fc-break-event"],
      });
    }

    const visibleStart = new Date(initialDate);
    const visibleEnd = new Date(initialDate);
    if (initialView === "resourceTimeGridDay") {
      visibleEnd.setDate(visibleEnd.getDate() + 1);
    } else {
      visibleStart.setDate(visibleStart.getDate() - visibleStart.getDay());
      visibleEnd.setDate(visibleStart.getDate() + 7);
    }
    const rangeStart = formatDate(visibleStart);
    const rangeEnd = formatDate(visibleEnd);

    const visibleStaffIds = new Set(resources.map((r) => r.id));
    for (const v of vacations) {
      if (!visibleStaffIds.has(v.staff.id)) continue;
      const start = new Date(v.startDate);
      const end = new Date(v.endDate);
      const cursor = new Date(Math.max(start.getTime(), new Date(rangeStart).getTime()));
      const rangeEndDate = new Date(rangeEnd);
      while (cursor <= end && cursor <= rangeEndDate) {
        const dateStr = formatDate(cursor);
        if (dateStr >= rangeStart && dateStr <= rangeEnd) {
          out.push({
            id: `vacation-${v.id}-${dateStr}`,
            resourceId: v.staff.id,
            title: `${v.staff.firstName} ${v.staff.lastName} – ${vacationLabel}`,
            start: `${dateStr}T08:00:00`,
            end: `${dateStr}T22:00:00`,
            extendedProps: { type: "vacation" },
            classNames: ["fc-vacation-event"],
          });
        }
        cursor.setDate(cursor.getDate() + 1);
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
    vacationLabel,
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

  const handleDatesSet = useCallback(
    (arg: { view: { currentStart: Date } }) => {
      onNavigate?.(arg.view.currentStart);
    },
    [onNavigate]
  );

  const isViewingToday = formatDate(initialDate) === formatDate(new Date());
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (api) {
      api.gotoDate(initialDate);
    }
  }, [initialDate]);
  useEffect(() => {
    if (!isViewingToday) return;
    const api = calendarRef.current?.getApi();
    if (api) {
      const timer = setTimeout(() => {
        const now = new Date();
        const msFromMidnight =
          now.getHours() * 3600000 +
          now.getMinutes() * 60000 +
          now.getSeconds() * 1000;
        api.scrollToTime(msFromMidnight);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [initialDate, isViewingToday]);

  return (
    <div className="appointment-fullcalendar rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, resourceTimeGridPlugin, interactionPlugin]}
        initialView={initialView}
        initialDate={initialDate}
        locale={locale === "he" ? "he" : "en-gb"}
        direction={locale === "he" ? "rtl" : "ltr"}
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
        eventMinHeight={32}
        selectable={true}
        selectMirror={true}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        datesSet={handleDatesSet}
        eventContent={(arg) => {
          const type = arg.event.extendedProps?.type;
          if (type === "break") {
            return (
              <div className="fc-break-content flex h-full items-center justify-center gap-2 px-2">
                <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  {locale === "he" ? "הפסקה" : "Break"}
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
          const apt = arg.event.extendedProps?.appointment as AppointmentEvent | undefined;
          const serviceName = arg.event.extendedProps?.serviceName ?? "—";
          return (
            <div className="fc-appointment-content flex h-full flex-col justify-center gap-0.5 px-2 py-1 text-right">
              <p className="text-xs tabular-nums opacity-90">{arg.timeText}</p>
              <p className="truncate font-semibold">{arg.event.title}</p>
              <p className="truncate text-xs opacity-90">{serviceName}</p>
            </div>
          );
        }}
      />
    </div>
  );
}
