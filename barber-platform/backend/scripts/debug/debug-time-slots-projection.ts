import { NestFactory } from '@nestjs/core';
import { DateTime } from 'luxon';
import { AppointmentStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getAvailabilitySlotStepMinutes } from '../../src/common/availability-slot-interval';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  businessLocalYmdFromJsDate,
  formatInstantLocalHhmm,
  isCalendarDayHolidayInZone,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
  type HolidayCheckRow,
} from '../../src/common/business-local-time';
import { ensureValidBusinessZone, getBusinessNow } from '../../src/common/time-engine';
import { hhmmToMinutes, minutesToHhmm, type TimeRangeMin } from '../../src/availability/simple-availability.engine';
import { computeSlotStartsFromWorkingAndBusy } from '../../src/availability/business-local-interval-availability.engine';

type DebugLikelyReason =
  | 'STAFF_NOT_FOUND'
  | 'STAFF_INACTIVE'
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_INACTIVE'
  | 'SERVICE_NOT_ASSIGNED_TO_STAFF'
  | 'NO_WORKING_HOURS'
  | 'DAY_CLOSED'
  | 'TIME_OFF'
  | 'HOLIDAY'
  | 'PROJECTION_NOT_GENERATED_FOR_DATE'
  | 'PROJECTION_GENERATED_ZERO_SLOTS'
  | 'PROJECTION_RANGE_TOO_SHORT'
  | 'UNKNOWN_NEEDS_MANUAL_REVIEW';

const TARGET = {
  businessId:
    process.env.DEBUG_TS_BUSINESS_ID ??
    'a0000001-0000-4000-8000-000000000001',
  date: process.env.DEBUG_TS_DATE ?? '2026-04-26',
  staffId:
    process.env.DEBUG_TS_STAFF_ID ??
    'a0000001-0000-4000-8000-000000100009',
  serviceId:
    process.env.DEBUG_TS_SERVICE_ID ??
    'a0000001-0000-4000-8000-000000000015',
} as const;

type SlotRow = {
  id: string;
  date: Date;
  startTime: string;
  endMin: number;
  durationMinutes: number;
  status: string;
  holdId: string | null;
  appointmentId: string | null;
};

function overlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function addOccupiedFromWallIntervals(params: {
  slotStartMinutes: number[];
  occupied: Set<string>;
  minDuration: number;
  ymd: string;
  timeZone: string;
  intervals: Array<{ start: Date; end: Date }>;
}): void {
  const dayBase = DateTime.fromISO(params.ymd, { zone: params.timeZone }).startOf('day');
  const dayEndExcl = dayBase.plus({ days: 1 });

  for (const iv of params.intervals) {
    const s = DateTime.fromJSDate(iv.start).setZone(params.timeZone);
    const e = DateTime.fromJSDate(iv.end).setZone(params.timeZone);
    const clipStart = s > dayBase ? s : dayBase;
    const clipEnd = e < dayEndExcl ? e : dayEndExcl;
    if (clipStart >= clipEnd) continue;

    const startMin = clipStart.diff(dayBase, 'minutes').minutes;
    const endMin = clipEnd.diff(dayBase, 'minutes').minutes;

    for (const m of params.slotStartMinutes) {
      if (overlap(m, m + params.minDuration, startMin, endMin)) {
        params.occupied.add(minutesToHhmm(m));
      }
    }
  }
}

function computeServiceAwareStarts(
  freeStarts: string[],
  durationMinutes: number | null,
  stepMinutes: number,
): string[] {
  if (durationMinutes == null || durationMinutes <= 0) return [];
  const needed = Math.max(1, Math.ceil(durationMinutes / stepMinutes));
  const free = new Set(freeStarts);
  const candidates = [...free].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
  const out: string[] = [];
  for (const st of candidates) {
    const m0 = hhmmToMinutes(st);
    let ok = true;
    for (let i = 0; i < needed; i++) {
      if (!free.has(minutesToHhmm(m0 + i * stepMinutes))) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(st);
  }
  return out;
}

function printSection(label: string, payload: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);

  const { businessId, date, staffId, serviceId } = TARGET;
  const ymd = date.slice(0, 10);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, timezone: true, isActive: true },
  });
  const timezone = ensureValidBusinessZone(
    resolveScheduleWallClockZone(business?.timezone),
  );
  const businessNow = getBusinessNow(timezone);
  const stepMinutes = Math.max(
    1,
    getAvailabilitySlotStepMinutes({
      get: (key: string, fallback?: string) =>
        key === 'AVAILABILITY_SLOT_STEP_MINUTES'
          ? process.env.AVAILABILITY_SLOT_STEP_MINUTES
          : fallback,
    } as never),
  );

  printSection('A. Request identity', {
    businessId,
    date: ymd,
    staffId,
    serviceId,
    businessTimezone: timezone,
    businessNow: businessNow.toFormat('HH:mm'),
    businessNowIso: businessNow.toISO({ includeOffset: true }),
  });

  const { startMs, endMs } = businessLocalDayBounds(timezone, ymd);
  const dayStart = new Date(startMs);
  const dayEndExclusive = new Date(endMs);
  const dayOfWeek = businessLocalDayOfWeek(timezone, ymd);
  const nowUtc = new Date();

  const [
    staff,
    service,
    staffService,
    allBookableStaffServices,
    weeklyWh,
    dayOverride,
    weeklyBreaks,
    breakExceptions,
    timeOffRows,
    holidays,
    appointments,
    activeHolds,
    allTimeSlotsForDay,
  ] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, businessId: true, isActive: true, deletedAt: true },
    }),
    prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        businessId: true,
        isActive: true,
        deletedAt: true,
        durationMinutes: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
      },
    }),
    prisma.staffService.findFirst({
      where: { staffId, serviceId },
      select: {
        id: true,
        allowBooking: true,
        durationMinutes: true,
      },
    }),
    prisma.staffService.findMany({
      where: {
        staffId,
        allowBooking: true,
        service: {
          deletedAt: null,
          isActive: true,
        },
      },
      select: {
        durationMinutes: true,
        service: {
          select: {
            durationMinutes: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
            deletedAt: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.staffWorkingHours.findMany({
      where: { staffId, dayOfWeek },
      select: { dayOfWeek: true, startTime: true, endTime: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffWorkingHoursDateOverride.findMany({
      where: { staffId, date: { gte: dayStart, lt: dayEndExclusive } },
      select: { date: true, isClosed: true, startTime: true, endTime: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffBreak.findMany({
      where: { staffId, dayOfWeek },
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffBreakException.findMany({
      where: { staffId, date: { gte: dayStart, lt: dayEndExclusive } },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        kind: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffTimeOff.findMany({
      where: {
        staffId,
        status: 'APPROVED',
        startDate: { lt: dayEndExclusive },
        endDate: { gte: dayStart },
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        isAllDay: true,
        status: true,
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.businessHoliday.findMany({
      where: {
        businessId,
        OR: [
          { isRecurring: false, date: { gte: dayStart, lt: dayEndExclusive } },
          { isRecurring: true },
        ],
      },
      select: { id: true, date: true, isRecurring: true, name: true },
      orderBy: { date: 'asc' },
    }),
    prisma.appointment.findMany({
      where: {
        businessId,
        staffId,
        status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
        startTime: { lt: dayEndExclusive },
        endTime: { gt: dayStart },
      },
      select: { id: true, status: true, startTime: true, endTime: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.slotHold.findMany({
      where: {
        businessId,
        staffId,
        consumedAt: null,
        expiresAt: { gt: nowUtc },
        startTime: { lt: dayEndExclusive },
        endTime: { gt: dayStart },
      },
      select: { id: true, startTime: true, endTime: true, expiresAt: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.timeSlot.findMany({
      where: { businessId, staffId, date: new Date(ymd) },
      select: {
        id: true,
        date: true,
        startTime: true,
        endMin: true,
        durationMinutes: true,
        status: true,
        holdId: true,
        appointmentId: true,
      },
      orderBy: { startTime: 'asc' },
    }),
  ]);

  const staffExists = Boolean(staff && staff.businessId === businessId);
  const staffActive = Boolean(staffExists && staff?.isActive && staff?.deletedAt == null);
  const serviceExists = Boolean(service && service.businessId === businessId);
  const serviceActive = Boolean(serviceExists && service?.isActive && service?.deletedAt == null);
  const staffServiceExists = Boolean(staffService);
  const staffServiceEnabled = Boolean(staffService?.allowBooking);

  printSection('B. Staff/service validation', {
    staffExists,
    staffActive,
    serviceExists,
    serviceActive,
    serviceDuration: service?.durationMinutes ?? null,
    bufferBefore: service?.bufferBeforeMinutes ?? null,
    bufferAfter: service?.bufferAfterMinutes ?? null,
    staffServiceExists,
    staffServiceEnabled,
    staffServiceDuration: staffService?.durationMinutes ?? null,
  });

  const whResolved = resolveStaffWorkingHoursForBusinessLocalDay({
    ymd,
    timeZone: timezone,
    weeklyRows: weeklyWh,
    dateOverrides: dayOverride,
  });
  const activeOverride = dayOverride[0] ?? null;
  const workingHoursSource = activeOverride
    ? activeOverride.isClosed
      ? 'date_override_closed'
      : activeOverride.startTime && activeOverride.endTime
        ? 'date_override_open'
        : 'date_override_invalid_fallback_or_none'
    : weeklyWh.length > 0
      ? 'weekly'
      : 'none';
  const isClosed = activeOverride?.isClosed === true;
  const holidayRows = holidays as HolidayCheckRow[];
  const isHoliday = isCalendarDayHolidayInZone(ymd, holidayRows, timezone);

  printSection('C. Source schedule', {
    dayOfWeek,
    workingHoursSource,
    isClosed,
    workingHoursFound: Boolean(whResolved),
    workingHours: whResolved ?? null,
    weeklyWorkingHoursRows: weeklyWh,
    dateOverrides: dayOverride.map((o) => ({
      dateLocal: businessLocalYmdFromJsDate(timezone, o.date),
      isClosed: o.isClosed,
      startTime: o.startTime,
      endTime: o.endTime,
    })),
    breaks: {
      weekly: weeklyBreaks,
      exceptions: breakExceptions.map((b) => ({
        id: b.id,
        dateLocal: businessLocalYmdFromJsDate(timezone, b.date),
        startTime: b.startTime,
        endTime: b.endTime,
        kind: b.kind,
      })),
    },
    timeOff: timeOffRows.map((t) => ({
      id: t.id,
      status: t.status,
      isAllDay: t.isAllDay,
      startLocal: formatInstantLocalHhmm(t.startDate, timezone),
      endLocal: formatInstantLocalHhmm(t.endDate, timezone),
      startTime: t.startTime,
      endTime: t.endTime,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      isRecurring: h.isRecurring,
      dateLocal: h.date ? businessLocalYmdFromJsDate(timezone, h.date) : null,
    })),
    isHoliday,
  });

  const serviceBlockMinutes =
    service != null
      ? Math.max(
          1,
          service.durationMinutes + (service.bufferBeforeMinutes ?? 0) + (service.bufferAfterMinutes ?? 0),
        )
      : null;
  const freeRows = allTimeSlotsForDay.filter((r) => r.status === 'free');
  const blockedRows = allTimeSlotsForDay.filter((r) => r.status !== 'free');
  const serviceAwareStartsFromExisting = computeServiceAwareStarts(
    freeRows.map((r) => r.startTime),
    serviceBlockMinutes,
    stepMinutes,
  );

  printSection('D. Current time_slots table state', {
    note: 'time_slots has no serviceId column. Counts below are for businessId+staffId+date, plus service-aware derivation.',
    identity: { businessId, staffId, serviceId, date: ymd },
    totalRows: allTimeSlotsForDay.length,
    availableRows: freeRows.length,
    blockedRows: blockedRows.length,
    minStartTime: allTimeSlotsForDay[0]?.startTime ?? null,
    maxEndTime:
      allTimeSlotsForDay.length > 0
        ? minutesToHhmm(
            allTimeSlotsForDay.reduce((max, r) => Math.max(max, r.endMin), 0),
          )
        : null,
    serviceAwareAvailableStartsCount: serviceAwareStartsFromExisting.length,
    serviceAwareAvailableStartsFirst10: serviceAwareStartsFromExisting.slice(0, 10),
    first10Rows: allTimeSlotsForDay.slice(0, 10),
  });

  const rangeStart = DateTime.fromISO(ymd, { zone: timezone }).startOf('day');
  const rangeEnd = rangeStart.plus({ days: 30 });
  const coverageRows = await prisma.timeSlot.findMany({
    where: {
      businessId,
      staffId,
      date: {
        gte: rangeStart.toJSDate(),
        lt: rangeEnd.toJSDate(),
      },
    },
    select: {
      date: true,
      startTime: true,
      status: true,
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  const earliest = await prisma.timeSlot.findFirst({
    where: { businessId, staffId },
    select: { date: true },
    orderBy: { date: 'asc' },
  });
  const latest = await prisma.timeSlot.findFirst({
    where: { businessId, staffId },
    select: { date: true },
    orderBy: { date: 'desc' },
  });

  const byDate = new Map<
    string,
    {
      totalRows: number;
      freeStarts: string[];
    }
  >();
  for (const row of coverageRows) {
    const d = businessLocalYmdFromJsDate(timezone, row.date);
    const curr = byDate.get(d) ?? { totalRows: 0, freeStarts: [] };
    curr.totalRows += 1;
    if (row.status === 'free') curr.freeStarts.push(row.startTime);
    byDate.set(d, curr);
  }

  const coverageWindow: Array<{
    date: string;
    totalRows: number;
    serviceAwareStarts: number;
  }> = [];
  for (let i = 0; i < 30; i++) {
    const d = rangeStart.plus({ days: i }).toISODate()!;
    const curr = byDate.get(d) ?? { totalRows: 0, freeStarts: [] };
    coverageWindow.push({
      date: d,
      totalRows: curr.totalRows,
      serviceAwareStarts: computeServiceAwareStarts(
        curr.freeStarts,
        serviceBlockMinutes,
        stepMinutes,
      ).length,
    });
  }
  const datesWithRows = coverageWindow.filter((d) => d.totalRows > 0).map((d) => d.date);
  const datesWithZeroRows = coverageWindow.filter((d) => d.totalRows === 0).map((d) => d.date);

  const projectedDateRange = {
    minProjectedDate:
      earliest?.date != null ? businessLocalYmdFromJsDate(timezone, earliest.date) : null,
    maxProjectedDate:
      latest?.date != null ? businessLocalYmdFromJsDate(timezone, latest.date) : null,
  };

  printSection('E. Projection coverage', {
    projectedDateRange,
    next30Days: coverageWindow,
    datesWithRows,
    datesWithZeroRows,
  });

  let minEffectiveDuration = 0;
  for (const ss of allBookableStaffServices) {
    if (ss.service.deletedAt || !ss.service.isActive) continue;
    const core = ss.durationMinutes > 0 ? ss.durationMinutes : ss.service.durationMinutes;
    const eff = core + (ss.service.bufferBeforeMinutes ?? 0) + (ss.service.bufferAfterMinutes ?? 0);
    if (minEffectiveDuration === 0 || eff < minEffectiveDuration) {
      minEffectiveDuration = eff;
    }
  }

  const breaksForGeneration: TimeRangeMin[] = [
    ...weeklyBreaks.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    })),
    ...breakExceptions.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    })),
  ];

  let dryRunFreeStarts: string[] = [];
  let dryRunServiceStarts: string[] = [];
  let dryRunSkippedReason: string | null = null;

  if (!staffExists) {
    dryRunSkippedReason = 'STAFF_NOT_FOUND_FOR_BUSINESS';
  } else if (!staffActive) {
    dryRunSkippedReason = 'STAFF_INACTIVE_OR_DELETED';
  } else if (!whResolved) {
    dryRunSkippedReason = 'NO_WORKING_HOURS_FOR_DATE';
  } else if (minEffectiveDuration <= 0) {
    dryRunSkippedReason =
      'NO_BOOKABLE_ACTIVE_STAFF_SERVICES_FOR_MIN_DURATION_BASELINE';
  } else {
    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      whResolved.startTime,
      whResolved.endTime,
      breaksForGeneration,
      minEffectiveDuration,
      stepMinutes,
    );
    const occupied = new Set<string>();
    addOccupiedFromWallIntervals({
      slotStartMinutes,
      occupied,
      minDuration: minEffectiveDuration,
      ymd,
      timeZone: timezone,
      intervals: [
        ...appointments.map((a) => ({ start: a.startTime, end: a.endTime })),
        ...activeHolds.map((h) => ({ start: h.startTime, end: h.endTime })),
      ],
    });
    dryRunFreeStarts = slotStartMinutes
      .filter((m) => !occupied.has(minutesToHhmm(m)))
      .map((m) => minutesToHhmm(m))
      .sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
    dryRunServiceStarts = computeServiceAwareStarts(
      dryRunFreeStarts,
      serviceBlockMinutes,
      stepMinutes,
    );
    if (dryRunServiceStarts.length === 0) {
      dryRunSkippedReason =
        'GENERATION_LOGIC_RAN_BUT_ZERO_SERVICE_AWARE_CANDIDATES';
    }
  }

  printSection('F. Projection generation dry-run', {
    generationReusedFrom:
      'TimeSlotService.regenerateDay logic replicated read-only (same helpers and overlap rules, no writes).',
    minDurationBaselineUsedByProjection: minEffectiveDuration || null,
    serviceBlockMinutes,
    generatedFreeRowCount: dryRunFreeStarts.length,
    generatedFreeRowFirst10: dryRunFreeStarts.slice(0, 10),
    generatedSlotCount: dryRunServiceStarts.length,
    candidateSlots: dryRunServiceStarts,
    first10GeneratedCandidateSlots: dryRunServiceStarts.slice(0, 10),
    skippedReason: dryRunServiceStarts.length === 0 ? dryRunSkippedReason : null,
  });

  const targetCoverageEntry = coverageWindow.find((d) => d.date === ymd);
  const targetHasRows = (targetCoverageEntry?.totalRows ?? 0) > 0;
  const targetServiceStarts = targetCoverageEntry?.serviceAwareStarts ?? 0;
  const fullDayTimeOff = timeOffRows.some((t) => t.isAllDay);

  let likelyReason: DebugLikelyReason = 'UNKNOWN_NEEDS_MANUAL_REVIEW';
  if (!staffExists) likelyReason = 'STAFF_NOT_FOUND';
  else if (!staffActive) likelyReason = 'STAFF_INACTIVE';
  else if (!serviceExists) likelyReason = 'SERVICE_NOT_FOUND';
  else if (!serviceActive) likelyReason = 'SERVICE_INACTIVE';
  else if (!staffServiceExists || !staffServiceEnabled)
    likelyReason = 'SERVICE_NOT_ASSIGNED_TO_STAFF';
  else if (!whResolved) likelyReason = isClosed ? 'DAY_CLOSED' : 'NO_WORKING_HOURS';
  else if (fullDayTimeOff) likelyReason = 'TIME_OFF';
  else if (isHoliday) likelyReason = 'HOLIDAY';
  else if (!targetHasRows) {
    const minDate = projectedDateRange.minProjectedDate;
    const maxDate = projectedDateRange.maxProjectedDate;
    if (minDate && maxDate && (ymd < minDate || ymd > maxDate)) {
      likelyReason = 'PROJECTION_RANGE_TOO_SHORT';
    } else {
      likelyReason = 'PROJECTION_NOT_GENERATED_FOR_DATE';
    }
  } else if (targetServiceStarts === 0 || dryRunServiceStarts.length === 0) {
    likelyReason = 'PROJECTION_GENERATED_ZERO_SLOTS';
  }

  const nextRecommendedActionByReason: Record<DebugLikelyReason, string> = {
    STAFF_NOT_FOUND: 'Verify target staffId and tenant mapping before projection.',
    STAFF_INACTIVE: 'Activate staff or pick an active staff profile.',
    SERVICE_NOT_FOUND: 'Verify serviceId exists in the same business.',
    SERVICE_INACTIVE: 'Activate service or use an active service.',
    SERVICE_NOT_ASSIGNED_TO_STAFF:
      'Assign service to staff (allowBooking=true) before expecting slots.',
    NO_WORKING_HOURS:
      'Add weekly/date-specific working hours for that business-local day.',
    DAY_CLOSED: 'Remove closed date override or open the day with start/end times.',
    TIME_OFF: 'Adjust approved time-off or choose another day.',
    HOLIDAY: 'Remove/adjust holiday row or choose another day.',
    PROJECTION_NOT_GENERATED_FOR_DATE:
      'Run projection generation for this business/staff/date window (seed/regenerate).',
    PROJECTION_GENERATED_ZERO_SLOTS:
      'Inspect dry-run inputs (breaks/time-off/occupied/minDuration) causing zero service-aware starts.',
    PROJECTION_RANGE_TOO_SHORT:
      'Extend seed range (daysAhead) so target date is included.',
    UNKNOWN_NEEDS_MANUAL_REVIEW:
      'Review full debug report and compare with timeSlots.regenerateDay preconditions.',
  };

  const finalResult = {
    businessId,
    date: ymd,
    staffId,
    serviceId,
    staffExists,
    staffActive,
    serviceExists,
    serviceActive,
    staffServiceExists: staffServiceExists && staffServiceEnabled,
    workingHoursFound: Boolean(whResolved),
    workingHours: whResolved
      ? { source: workingHoursSource, start: whResolved.startTime, end: whResolved.endTime }
      : null,
    breaksCount: weeklyBreaks.length + breakExceptions.length,
    timeOffCount: timeOffRows.length,
    holidaysCount: holidays.length,
    existingTimeSlotsCount: allTimeSlotsForDay.length,
    projectedDateRange,
    dryRunGeneratedSlotCount: dryRunServiceStarts.length,
    likelyReason,
    nextRecommendedAction: nextRecommendedActionByReason[likelyReason],
  };

  console.log('\nTIME_SLOTS_PROJECTION_DEBUG_RESULT:');
  console.log(JSON.stringify(finalResult, null, 2));

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
