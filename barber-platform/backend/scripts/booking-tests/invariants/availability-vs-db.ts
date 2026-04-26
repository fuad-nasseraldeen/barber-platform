/**
 * INV-4: Every slot offered by GET /availability must not overlap any
 * committed appointment or active hold in Postgres.
 *
 * Requires: BASE_URL + AUTH_TOKEN (HTTP) + DATABASE_URL (Prisma).
 */
import type { PrismaClient } from '@prisma/client';
import type { InvariantViolation } from './types';

interface OccupiedSpan {
  start: Date;
  end: Date;
  kind: 'appointment' | 'hold';
  id: string;
}

interface AvailabilityCheckOpts {
  prisma: PrismaClient;
  baseUrl: string;
  apiPrefix: string;
  authToken: string;
  businessId: string;
  staffId: string;
  serviceId: string;
  dateYmd: string;
  blockMinutes: number;
  businessTimezone: string;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function wallSlotToUtcInterval(
  dateYmd: string,
  wallHhmm: string,
  blockMinutes: number,
  tz: string,
): { start: Date; end: Date } {
  const { DateTime } = require('luxon') as typeof import('luxon');
  const dt = DateTime.fromISO(`${dateYmd}T${wallHhmm}:00`, { zone: tz });
  const startUtc = dt.toUTC().toJSDate();
  const endUtc = dt.plus({ minutes: blockMinutes }).toUTC().toJSDate();
  return { start: startUtc, end: endUtc };
}

function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && a.end > b.start;
}

export async function checkAvailabilityVsDb(
  opts: AvailabilityCheckOpts,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  const { DateTime } = require('luxon') as typeof import('luxon');
  const dayStart = DateTime.fromISO(`${opts.dateYmd}T00:00:00`, { zone: opts.businessTimezone })
    .toUTC()
    .toJSDate();
  const dayEnd = DateTime.fromISO(`${opts.dateYmd}T00:00:00`, { zone: opts.businessTimezone })
    .plus({ days: 1 })
    .toUTC()
    .toJSDate();

  const [appointments, holds] = await Promise.all([
    opts.prisma.$queryRaw<Array<{ id: string; startTime: Date; endTime: Date }>>`
      SELECT id, "startTime", "endTime" FROM appointments
      WHERE "staffId" = ${opts.staffId}
        AND "businessId" = ${opts.businessId}
        AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND "startTime" < ${dayEnd} AND "endTime" > ${dayStart}
    `,
    opts.prisma.$queryRaw<Array<{ id: string; start_time: Date; end_time: Date }>>`
      SELECT id, start_time, end_time FROM slot_holds
      WHERE staff_id = ${opts.staffId}
        AND business_id = ${opts.businessId}
        AND consumed_at IS NULL
        AND expires_at > NOW()
        AND start_time < ${dayEnd} AND end_time > ${dayStart}
    `,
  ]);

  const occupied: OccupiedSpan[] = [
    ...appointments.map((a) => ({
      start: a.startTime,
      end: a.endTime,
      kind: 'appointment' as const,
      id: a.id,
    })),
    ...holds.map((h) => ({
      start: h.start_time,
      end: h.end_time,
      kind: 'hold' as const,
      id: h.id,
    })),
  ];

  const url =
    `${opts.baseUrl}/${opts.apiPrefix}/availability?` +
    `businessId=${opts.businessId}&staffId=${opts.staffId}` +
    `&serviceId=${opts.serviceId}&date=${opts.dateYmd}&days=1&compact=1` +
    `&maxSlotsPerRow=192&chronologicalSlots=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.authToken}` },
  });
  if (!res.ok) {
    violations.push({
      code: 'AVAILABILITY_HTTP_ERROR',
      severity: 'warn',
      message: `GET /availability returned ${res.status}`,
    });
    return violations;
  }

  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body)
    ? body
    : (body as Record<string, unknown>).results ?? (body as Record<string, unknown>).data ?? [];
  if (!Array.isArray(rows)) return violations;

  const row = (rows as Array<{ staffId?: string; slots?: string[] }>).find(
    (r) =>
      r.staffId?.toLowerCase().replace(/-/g, '') ===
      opts.staffId.toLowerCase().replace(/-/g, ''),
  );
  const offeredSlots: string[] = row?.slots ?? [];

  for (const wallSlot of offeredSlots) {
    const slotIv = wallSlotToUtcInterval(
      opts.dateYmd,
      wallSlot,
      opts.blockMinutes,
      opts.businessTimezone,
    );
    for (const occ of occupied) {
      if (intervalsOverlap(slotIv, occ)) {
        violations.push({
          code: 'AVAILABILITY_OFFERS_OCCUPIED',
          severity: 'error',
          message: `Slot ${wallSlot} overlaps ${occ.kind} ${occ.id} (staff ${opts.staffId})`,
          detail: {
            offeredSlot: wallSlot,
            slotUtc: {
              start: slotIv.start.toISOString(),
              end: slotIv.end.toISOString(),
            },
            occupied: {
              kind: occ.kind,
              id: occ.id,
              start: occ.start.toISOString(),
              end: occ.end.toISOString(),
            },
          },
        });
      }
    }
  }

  return violations;
}
