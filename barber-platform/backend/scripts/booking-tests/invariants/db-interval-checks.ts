import type { PrismaClient } from '@prisma/client';
import type { InvariantViolation } from './types';

type OverlapRow = {
  id1: string;
  id2: string;
  staffId: string;
  s1: Date;
  e1: Date;
  s2: Date;
  e2: Date;
};

type HoldOverlapRow = {
  id1: string;
  id2: string;
  staff_id: string;
  s1: Date;
  e1: Date;
  s2: Date;
  e2: Date;
};

type CrossOverlapRow = {
  appointment_id: string;
  hold_id: string;
  staffId: string;
};

/**
 * INV-1: No two active appointments for the same staff overlap in time.
 * Uses half-open interval overlap: a.start < b.end AND a.end > b.start.
 */
export async function checkAppointmentOverlaps(
  prisma: PrismaClient,
  businessId?: string,
): Promise<InvariantViolation[]> {
  const rows: OverlapRow[] = businessId
    ? await prisma.$queryRaw`
      SELECT a1.id AS "id1", a2.id AS "id2", a1."staffId" AS "staffId",
             a1."startTime" AS "s1", a1."endTime" AS "e1",
             a2."startTime" AS "s2", a2."endTime" AS "e2"
      FROM appointments a1
      JOIN appointments a2
        ON a1."staffId" = a2."staffId" AND a1.id < a2.id
      WHERE a1."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND a2."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND a1."businessId" = ${businessId}
        AND a2."businessId" = ${businessId}
        AND a1."startTime" < a2."endTime"
        AND a1."endTime" > a2."startTime"
      LIMIT 50
    `
    : await prisma.$queryRaw`
      SELECT a1.id AS "id1", a2.id AS "id2", a1."staffId" AS "staffId",
             a1."startTime" AS "s1", a1."endTime" AS "e1",
             a2."startTime" AS "s2", a2."endTime" AS "e2"
      FROM appointments a1
      JOIN appointments a2
        ON a1."staffId" = a2."staffId" AND a1.id < a2.id
      WHERE a1."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND a2."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND a1."startTime" < a2."endTime"
        AND a1."endTime" > a2."startTime"
      LIMIT 50
    `;

  return rows.map((r) => ({
    code: 'APPOINTMENT_OVERLAP',
    severity: 'error' as const,
    message: `Overlapping active appointments for staff ${r.staffId}: ${r.id1} vs ${r.id2}`,
    detail: {
      id1: r.id1,
      id2: r.id2,
      staffId: r.staffId,
      a1: { start: r.s1.toISOString(), end: r.e1.toISOString() },
      a2: { start: r.s2.toISOString(), end: r.e2.toISOString() },
    },
  }));
}

/**
 * INV-2: No two active (unconsumed, unexpired) slot holds for the same staff overlap.
 */
export async function checkSlotHoldOverlaps(
  prisma: PrismaClient,
  businessId?: string,
): Promise<InvariantViolation[]> {
  const rows: HoldOverlapRow[] = businessId
    ? await prisma.$queryRaw`
      SELECT h1.id AS "id1", h2.id AS "id2", h1.staff_id,
             h1.start_time AS "s1", h1.end_time AS "e1",
             h2.start_time AS "s2", h2.end_time AS "e2"
      FROM slot_holds h1
      JOIN slot_holds h2
        ON h1.staff_id = h2.staff_id AND h1.id < h2.id
      WHERE h1.business_id = ${businessId}
        AND h2.business_id = ${businessId}
        AND h1.consumed_at IS NULL AND h2.consumed_at IS NULL
        AND h1.expires_at > NOW() AND h2.expires_at > NOW()
        AND h1.start_time < h2.end_time
        AND h1.end_time > h2.start_time
      LIMIT 50
    `
    : await prisma.$queryRaw`
      SELECT h1.id AS "id1", h2.id AS "id2", h1.staff_id,
             h1.start_time AS "s1", h1.end_time AS "e1",
             h2.start_time AS "s2", h2.end_time AS "e2"
      FROM slot_holds h1
      JOIN slot_holds h2
        ON h1.staff_id = h2.staff_id AND h1.id < h2.id
      WHERE h1.consumed_at IS NULL AND h2.consumed_at IS NULL
        AND h1.expires_at > NOW() AND h2.expires_at > NOW()
        AND h1.start_time < h2.end_time
        AND h1.end_time > h2.start_time
      LIMIT 50
    `;

  return rows.map((r) => ({
    code: 'SLOT_HOLD_OVERLAP',
    severity: 'error' as const,
    message: `Overlapping active holds for staff ${r.staff_id}: ${r.id1} vs ${r.id2}`,
    detail: {
      id1: r.id1,
      id2: r.id2,
      staffId: r.staff_id,
      h1: { start: r.s1.toISOString(), end: r.e1.toISOString() },
      h2: { start: r.s2.toISOString(), end: r.e2.toISOString() },
    },
  }));
}

/**
 * INV-3: Active appointment must not overlap an active hold belonging to a different party.
 * (Excludes the hold the appointment was created from.)
 */
export async function checkAppointmentVsHoldOverlaps(
  prisma: PrismaClient,
  businessId?: string,
): Promise<InvariantViolation[]> {
  const rows: CrossOverlapRow[] = businessId
    ? await prisma.$queryRaw`
      SELECT a.id AS "appointment_id", h.id AS "hold_id", a."staffId" AS "staffId"
      FROM appointments a
      JOIN slot_holds h ON h.staff_id = a."staffId"
      WHERE a."businessId" = ${businessId}
        AND h.business_id = ${businessId}
        AND a."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND h.consumed_at IS NULL
        AND h.expires_at > NOW()
        AND a."startTime" < h.end_time
        AND a."endTime" > h.start_time
        AND (a."slotHoldId" IS NULL OR a."slotHoldId" <> h.id)
      LIMIT 50
    `
    : await prisma.$queryRaw`
      SELECT a.id AS "appointment_id", h.id AS "hold_id", a."staffId" AS "staffId"
      FROM appointments a
      JOIN slot_holds h ON h.staff_id = a."staffId"
      WHERE a."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND h.consumed_at IS NULL
        AND h.expires_at > NOW()
        AND a."startTime" < h.end_time
        AND a."endTime" > h.start_time
        AND (a."slotHoldId" IS NULL OR a."slotHoldId" <> h.id)
      LIMIT 50
    `;

  return rows.map((r) => ({
    code: 'APPOINTMENT_VS_HOLD_OVERLAP',
    severity: 'error' as const,
    message: `Active appointment ${r.appointment_id} overlaps foreign active hold ${r.hold_id} (staff ${r.staffId})`,
    detail: {
      appointmentId: r.appointment_id,
      holdId: r.hold_id,
      staffId: r.staffId,
    },
  }));
}
