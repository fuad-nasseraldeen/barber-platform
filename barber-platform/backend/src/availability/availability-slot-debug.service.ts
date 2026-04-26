import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HolidayCheckRow } from '../common/business-local-time';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  businessLocalYmdFromJsDate,
  formatInstantLocalHhmm,
  isCalendarDayHolidayInZone,
  resolveBusinessTimeZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
} from '../common/business-local-time';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import { ensureValidBusinessZone } from '../common/time-engine';
import { PrismaService } from '../prisma/prisma.service';
import { utcNowJsDate } from '../common/time';
import {
  explainSlotDecision,
  enumerateGridCandidateStarts,
  type ExplainSlotContext,
  type SlotDebugRejectReason,
} from './availability-slot-explain';
import { ComputedAvailabilityService } from './computed-availability.service';
import {
  appointmentsToMinuteIntervalsOnBusinessLocalDay,
  mergeMinuteIntervals,
  slotHoldToBusyInterval,
  type MinuteInterval,
} from './interval-availability.engine';
import { hhmmToMinutes, minutesToHhmm } from './simple-availability.engine';
import type { AvailabilityQueryDto } from '../booking/dto/availability-query.dto';

type BookingSpan = { startTime: Date; endTime: Date };

export type AvailabilityDebugResponse = {
  date: string;
  businessId: string;
  staffId: string;
  serviceId: string;
  timezone: string;
  stepMinutes: number;
  serviceDurationMinutes: number;
  /** When set, slot enumeration was skipped (whole-day or config block). */
  dayBlockReason?:
    | 'holiday'
    | 'time_off'
    | 'outside_booking_window'
    | 'no_staff'
    | 'no_service'
    | 'no_working_hours';
  note: string;
  workingHours: Array<{ start: string; end: string }>;
  bookings: Array<{ startTime: string; endTime: string }>;
  holds: Array<{ startTime: string; endTime: string }>;
  breaks: Array<{ start: string; end: string }>;
  holidays: Array<{ isRecurring: boolean; date: string | null }>;
  mergedBusyIntervals: Array<{ start: string; end: string }>;
  rejectedSlots: Array<{ time: string; reason: SlotDebugRejectReason }>;
  validSlots: string[];
  summary: {
    candidateSlotsEvaluated: number;
    validCount: number;
    rejectedCount: number;
  };
};

@Injectable()
export class AvailabilitySlotDebugService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly computedAvailability: ComputedAvailabilityService,
  ) {}

  async build(query: AvailabilityQueryDto): Promise<AvailabilityDebugResponse> {
    const businessId = query.businessId;
    const staffId = query.staffId;
    const serviceId = query.serviceId;
    const ymd = query.date.slice(0, 10);

    const bizRow = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const timeZone = ensureValidBusinessZone(resolveBusinessTimeZone(bizRow?.timezone));

    const base: AvailabilityDebugResponse = {
      date: ymd,
      businessId,
      staffId,
      serviceId,
      timezone: timeZone,
      stepMinutes: getAvailabilitySlotStepMinutes(this.config),
      serviceDurationMinutes: 0,
      note:
        'Interval geometry only: no fragmentation rank, no AVAILABILITY_MAX_SLOTS_PER_HOUR (see production GET /availability).',
      workingHours: [],
      bookings: [],
      holds: [],
      breaks: [],
      holidays: [],
      mergedBusyIntervals: [],
      rejectedSlots: [],
      validSlots: [],
      summary: { candidateSlotsEvaluated: 0, validCount: 0, rejectedCount: 0 },
    };

    if (!this.computedAvailability.isWithinBookingWindow(ymd, timeZone)) {
      return {
        ...base,
        dayBlockReason: 'outside_booking_window',
        note: `${base.note} Day outside BOOKING_WINDOW_DAYS.`,
      };
    }

    const { startMs: dayStartMs, endMs: dayEndExclusiveMs } = businessLocalDayBounds(timeZone, ymd);
    const rangeStart = new Date(dayStartMs);
    const rangeEndExclusive = new Date(dayEndExclusiveMs);
    const now = utcNowJsDate();

    const [staffBundle, appointments, activeSlotHolds, holidayRows] = await Promise.all([
      this.prisma.staff.findUnique({
        where: { id: staffId, businessId, isActive: true, deletedAt: null },
        include: {
          staffWorkingHours: true,
          staffWorkingHoursDateOverrides: {
            where: { date: { gte: rangeStart, lt: rangeEndExclusive } },
          },
          staffBreaks: true,
          staffBreakExceptions: {
            where: { date: { gte: rangeStart, lt: rangeEndExclusive } },
          },
          staffTimeOff: {
            where: {
              status: 'APPROVED',
              startDate: { lt: rangeEndExclusive },
              endDate: { gte: rangeStart },
            },
          },
          staffServices: {
            where: { serviceId, allowBooking: true },
            select: {
              durationMinutes: true,
              allowBooking: true,
              service: {
                select: {
                  durationMinutes: true,
                  bufferBeforeMinutes: true,
                  bufferAfterMinutes: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          staffId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startTime: { lt: rangeEndExclusive },
          endTime: { gt: rangeStart },
        },
        select: { startTime: true, endTime: true },
      }),
      this.prisma.slotHold.findMany({
        where: {
          businessId,
          staffId,
          consumedAt: null,
          expiresAt: { gt: now },
          startTime: { lt: rangeEndExclusive },
          endTime: { gt: rangeStart },
        },
        select: { startTime: true, endTime: true },
      }),
      this.prisma.businessHoliday.findMany({
        where: {
          businessId,
          OR: [
            { isRecurring: false, date: { gte: rangeStart, lt: rangeEndExclusive } },
            { isRecurring: true },
          ],
        },
        select: { date: true, isRecurring: true },
      }),
    ]);

    const holidays = holidayRows as HolidayCheckRow[];
    base.holidays = holidayRows.map((h) => ({
      isRecurring: h.isRecurring,
      date: h.date ? businessLocalYmdFromJsDate(timeZone, h.date) : null,
    }));

    if (isCalendarDayHolidayInZone(ymd, holidays, timeZone)) {
      base.dayBlockReason = 'holiday';
      base.bookings = formatSpansForDay(filterSpansForDay(appointments as BookingSpan[], ymd, timeZone), timeZone);
      base.holds = formatSpansForDay(
        filterSpansForDay(activeSlotHolds.map(slotHoldToBusyInterval), ymd, timeZone),
        timeZone,
      );
      base.note = `${base.note} Calendar holiday — no slots offered.`;
      return base;
    }

    if (!staffBundle) {
      return { ...base, dayBlockReason: 'no_staff' };
    }

    const ss = staffBundle.staffServices[0];
    if (!ss?.service || ss.service.deletedAt) {
      return { ...base, dayBlockReason: 'no_service' };
    }

    const serviceMinutes = Math.max(
      1,
      (ss.durationMinutes > 0 ? ss.durationMinutes : ss.service.durationMinutes) || 1,
    );
    const duration =
      serviceMinutes + (ss.service.bufferBeforeMinutes ?? 0) + (ss.service.bufferAfterMinutes ?? 0);
    base.serviceDurationMinutes = duration;

    const dayStart = rangeStart;
    const dayEnd = rangeEndExclusive;
    const timeOffToday = staffBundle.staffTimeOff.filter(
      (t) => t.startDate < dayEnd && t.endDate >= dayStart,
    );
    if (isDayBlockedByTimeOff(timeOffToday)) {
      base.dayBlockReason = 'time_off';
      base.bookings = formatSpansForDay(filterSpansForDay(appointments as BookingSpan[], ymd, timeZone), timeZone);
      base.holds = formatSpansForDay(
        filterSpansForDay(activeSlotHolds.map(slotHoldToBusyInterval), ymd, timeZone),
        timeZone,
      );
      base.note = `${base.note} Staff time off — no slots offered.`;
      return base;
    }

    const dow = businessLocalDayOfWeek(timeZone, ymd);
    const wh = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone,
      weeklyRows: staffBundle.staffWorkingHours,
      dateOverrides: staffBundle.staffWorkingHoursDateOverrides ?? [],
    });
    if (!wh) {
      return {
        ...base,
        dayBlockReason: 'no_working_hours',
        note: `${base.note} No working hours for this local calendar day.`,
      };
    }

    base.workingHours = [{ start: wh.startTime.slice(0, 5), end: wh.endTime.slice(0, 5) }];

    const breaksWeekly = staffBundle.staffBreaks.filter((b) => b.dayOfWeek === dow);
    const exToday = staffBundle.staffBreakExceptions.filter(
      (e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd,
    );
    base.breaks = [
      ...breaksWeekly.map((b) => ({ start: b.startTime.slice(0, 5), end: b.endTime.slice(0, 5) })),
      ...exToday.map((e) => ({ start: e.startTime.slice(0, 5), end: e.endTime.slice(0, 5) })),
    ];

    const apptsDay = filterSpansForDay(appointments as BookingSpan[], ymd, timeZone);
    const holdsDay = filterSpansForDay(activeSlotHolds.map(slotHoldToBusyInterval), ymd, timeZone);
    base.bookings = formatSpansForDay(apptsDay, timeZone);
    base.holds = formatSpansForDay(holdsDay, timeZone);

    const whStart = hhmmToMinutes(wh.startTime);
    const whEnd = hhmmToMinutes(wh.endTime);
    const weeklyMin: MinuteInterval[] = breaksWeekly.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    }));
    const exMin: MinuteInterval[] = exToday.map((e) => ({
      start: hhmmToMinutes(e.startTime),
      end: hhmmToMinutes(e.endTime),
    }));
    const breaksMerged = mergeMinuteIntervals([...weeklyMin, ...exMin]);

    const bookingBusy = appointmentsToMinuteIntervalsOnBusinessLocalDay(apptsDay, ymd, timeZone);
    const holdBusy = appointmentsToMinuteIntervalsOnBusinessLocalDay(holdsDay, ymd, timeZone);
    const mergedBusy = mergeMinuteIntervals([...bookingBusy, ...holdBusy]);
    base.mergedBusyIntervals = mergedBusy.map((iv) => ({
      start: minutesToHhmm(iv.start),
      end: minutesToHhmm(iv.end),
    }));

    const explainCtx: ExplainSlotContext = {
      workingWindowMinutes: { start: whStart, end: whEnd },
      breaksMerged,
      bookingBusy,
      holdBusy,
      serviceDurationMinutes: duration,
      stepMinutes: base.stepMinutes,
    };

    const candidates = enumerateGridCandidateStarts(whStart, whEnd, duration, base.stepMinutes);
    const rejected: Array<{ time: string; reason: SlotDebugRejectReason }> = [];
    const valid: string[] = [];

    for (const startMin of candidates) {
      const d = explainSlotDecision(startMin, explainCtx);
      const hhmm = minutesToHhmm(startMin);
      if (d.ok) {
        valid.push(hhmm);
      } else {
        rejected.push({ time: hhmm, reason: d.reason });
      }
    }

    base.validSlots = valid.sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
    base.rejectedSlots = rejected.sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));
    base.summary = {
      candidateSlotsEvaluated: candidates.length,
      validCount: valid.length,
      rejectedCount: rejected.length,
    };

    return base;
  }
}

function filterSpansForDay(all: BookingSpan[], dateStr: string, timeZone: string): BookingSpan[] {
  const { startMs, endMs } = businessLocalDayBounds(timeZone, dateStr.slice(0, 10));
  return all.filter((a) => a.startTime.getTime() < endMs && a.endTime.getTime() > startMs);
}

function formatSpansForDay(spans: BookingSpan[], timeZone: string): Array<{ startTime: string; endTime: string }> {
  return spans.map((s) => ({
    startTime: formatInstantLocalHhmm(s.startTime, timeZone),
    endTime: formatInstantLocalHhmm(s.endTime, timeZone),
  }));
}

function isDayBlockedByTimeOff(
  rows: Array<{ isAllDay: boolean; startTime: string | null; endTime: string | null }>,
): boolean {
  for (const t of rows) {
    if (t.isAllDay) return true;
    if (t.startTime && t.endTime) return true;
  }
  return false;
}
