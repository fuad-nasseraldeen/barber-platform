/**
 * Booking Stress Test Script
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/booking-stress-test.ts
 *
 * Prerequisites:
 * - Backend .env configured (DATABASE_URL, REDIS or ENABLE_REDIS=false)
 * - Run prisma migrate deploy
 * - Seed data with staff working hours: npm run prisma:seed-demo
 *   (or ensure StaffWorkingHours + StaffService exist for at least one staff)
 */

import { ConflictException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BookingService } from '../src/booking/booking.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Default 50 may exceed Supabase Session pooler; set BOOKING_STRESS_CONCURRENCY=15 or use Transaction pooler :6543. */
const CONCURRENCY = Math.max(
  1,
  parseInt(process.env.BOOKING_STRESS_CONCURRENCY || '50', 10) || 50,
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTestIds(prisma: PrismaService) {
  const staffWithHours = await prisma.staff.findFirst({
    where: {
      deletedAt: null,
      staffWorkingHours: { some: {} },
      staffServices: { some: {} },
    },
    include: {
      staffServices: { take: 1, include: { service: true } },
      staffWorkingHours: { take: 1 },
    },
  });
  if (!staffWithHours?.staffServices[0]) throw new Error('No staff with working hours and services. Run seed-demo.');
  const staff = staffWithHours;
  const ss = staffWithHours.staffServices[0];
  const service = ss.service;
  const bid = staff.businessId;
  const customer = await prisma.customer.findFirst({ where: { businessId: bid } });
  if (!customer) throw new Error('No customer in DB.');
  const durationMinutes =
    ss.durationMinutes +
    (service.bufferBeforeMinutes ?? 0) +
    (service.bufferAfterMinutes ?? 0);
  return {
    businessId: bid,
    staffId: staff.id,
    customerId: customer.id,
    serviceId: service.id,
    durationMinutes,
  };
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function getActorUserId(prisma: PrismaService, businessId: string): Promise<string> {
  const row = await prisma.businessUser.findFirst({
    where: { businessId, isActive: true },
    select: { userId: true },
  });
  if (!row) throw new Error('No active BusinessUser for business');
  return row.userId;
}

async function findValidSlot(
  prisma: PrismaService,
  staffId: string,
  minDaysAhead = 1,
): Promise<{ date: string; startTime: string }> {
  for (let d = minDaysAhead; d <= 60; d++) {
    const dateStr = futureDate(d);
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const wh = await prisma.staffWorkingHours.findFirst({ where: { staffId, dayOfWeek } });
    if (wh) {
      const [h] = wh.startTime.split(':');
      const startTime = `${h.padStart(2, '0')}:00`;
      const startDt = new Date(`${dateStr}T${startTime}:00`);
      const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
      const [overlap, timeOff] = await Promise.all([
        prisma.appointment.findFirst({
          where: {
            staffId,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startTime: { lt: endDt },
            endTime: { gt: startDt },
          },
        }),
        prisma.staffTimeOff.findFirst({
          where: {
            staffId,
            status: 'APPROVED',
            startDate: { lte: new Date(dateStr) },
            endDate: { gte: new Date(dateStr) },
          },
        }),
      ]);
      if (!overlap && !timeOff) return { date: dateStr, startTime };
    }
  }
  throw new Error('No free slot in next 60 days');
}

async function scenario1_highConcurrency(
  booking: BookingService,
  prisma: PrismaService,
  ids: Awaited<ReturnType<typeof getTestIds>>,
) {
  console.log(
    '\n--- Scenario 1: High Concurrency (50 concurrent confirmBookingFromHold on same slotHoldId) ---',
  );
  const { date, startTime } = await findValidSlot(prisma, ids.staffId);
  const actorUserId = await getActorUserId(prisma, ids.businessId);
  const { hold } = await booking.createSlotHoldForSlotSelection(
    {
      businessId: ids.businessId,
      staffId: ids.staffId,
      serviceId: ids.serviceId,
      customerId: ids.customerId,
      date,
      startTime,
      durationMinutes: ids.durationMinutes,
    },
    actorUserId,
  );

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      booking.confirmBookingFromHold({
        businessId: ids.businessId,
        slotHoldId: hold.id,
        notes: `Concurrent test ${i}`,
      }),
    ),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  const errors = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.message || 'unknown');

  console.log(`Results: ${succeeded} succeeded, ${failed} failed`);
  if (succeeded !== 1) {
    console.error(`FAIL: Expected exactly 1 success, got ${succeeded}`);
  } else {
    console.log('PASS: Exactly one booking created');
  }
  return { scenario: 1, success: succeeded === 1, succeeded, failed, errors: [...new Set(errors)].slice(0, 3) };
}

async function scenario2_duplicateSlotRejected(
  booking: BookingService,
  prisma: PrismaService,
  ids: Awaited<ReturnType<typeof getTestIds>>,
) {
  console.log('\n--- Scenario 2: Second confirm on same consumed hold → HOLD_ALREADY_USED / 409 ---');
  const { date, startTime } = await findValidSlot(prisma, ids.staffId, 2);
  const actorUserId = await getActorUserId(prisma, ids.businessId);
  const { hold } = await booking.createSlotHoldForSlotSelection(
    {
      businessId: ids.businessId,
      staffId: ids.staffId,
      serviceId: ids.serviceId,
      customerId: ids.customerId,
      date,
      startTime,
      durationMinutes: ids.durationMinutes,
    },
    actorUserId,
  );

  await booking.confirmBookingFromHold({
    businessId: ids.businessId,
    slotHoldId: hold.id,
  });

  let secondOk = false;
  try {
    await booking.confirmBookingFromHold({
      businessId: ids.businessId,
      slotHoldId: hold.id,
    });
    secondOk = true;
  } catch (e: unknown) {
    if (!(e instanceof ConflictException)) throw e;
  }

  if (secondOk) {
    console.error('FAIL: Second identical booking should be rejected');
  } else {
    console.log('PASS: Duplicate slot rejected');
  }
  return { scenario: 2, success: !secondOk };
}

async function scenario3_secondBookSameSlotFails(
  booking: BookingService,
  prisma: PrismaService,
  ids: Awaited<ReturnType<typeof getTestIds>>,
) {
  console.log('\n--- Scenario 3: Second overlapping slot-hold on booked slot must fail (EXCLUDE) ---');
  const { date, startTime } = await findValidSlot(prisma, ids.staffId, 10);
  const actorUserId = await getActorUserId(prisma, ids.businessId);
  const { hold } = await booking.createSlotHoldForSlotSelection(
    {
      businessId: ids.businessId,
      staffId: ids.staffId,
      serviceId: ids.serviceId,
      customerId: ids.customerId,
      date,
      startTime,
      durationMinutes: ids.durationMinutes,
    },
    actorUserId,
  );
  await booking.confirmBookingFromHold({
    businessId: ids.businessId,
    slotHoldId: hold.id,
  });

  try {
    await booking.createSlotHoldForSlotSelection(
      {
        businessId: ids.businessId,
        staffId: ids.staffId,
        serviceId: ids.serviceId,
        customerId: ids.customerId,
        date,
        startTime,
        durationMinutes: ids.durationMinutes,
      },
      actorUserId,
    );
    console.error('FAIL: Expected conflict on overlapping hold after book');
    return { scenario: 3, success: false };
  } catch (e: unknown) {
    const ok = e instanceof ConflictException;
    console.log(ok ? 'PASS: Overlapping hold rejected' : `FAIL: ${(e as Error)?.message?.slice(0, 120)}`);
    return { scenario: 3, success: ok };
  }
}

async function main() {
  console.log('Booking Stress Test - Starting...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const booking = app.get(BookingService);
  const prisma = app.get(PrismaService);

  const ids = await getTestIds(prisma);
  console.log('Test IDs:', ids);

  const results: { scenario: number; success: boolean; [k: string]: unknown }[] = [];

  try {
    results.push(await scenario1_highConcurrency(booking, prisma, ids));
    results.push(await scenario2_duplicateSlotRejected(booking, prisma, ids));
    results.push(await scenario3_secondBookSameSlotFails(booking, prisma, ids));
  } finally {
    await app.close();
  }

  const passed = results.filter((r) => r.success).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} scenarios passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
