import { AppointmentStatus, PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { NestFactory } from '@nestjs/core';
import { formatBusinessTime, toUtcFromBusinessHhmm } from '../../src/common/time-engine';
import { AppModule } from '../../src/app.module';
import { TimeSlotService } from '../../src/availability/time-slot.service';
import {
  BENCHMARK_FIXTURE,
  reseedBenchmarkFixture,
} from './benchmark-fixture-lib';

const prisma = new PrismaClient();

const SEEDED_DATE_FROM = '2026-04-30';
const SEEDED_DATE_TO = '2026-05-06';
const TARGET_TEST_DATE = '2026-05-02';
const OWNER_EMAIL = 'fuadsami5@gmail.com';
const BUSINESS_ID = process.env.BUSINESS_ID ?? BENCHMARK_FIXTURE.businessId;

const DETERMINISTIC_CUSTOMERS = [
  {
    id: 'a0000001-0000-4000-8000-000000000301',
    email: 'benchmark.customer.1@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 1',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000302',
    email: 'benchmark.customer.2@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 2',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000303',
    email: 'benchmark.customer.3@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 3',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000304',
    email: 'benchmark.customer.4@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 4',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000305',
    email: 'benchmark.customer.5@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 5',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000306',
    email: 'benchmark.customer.6@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 6',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000307',
    email: 'benchmark.customer.7@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 7',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000308',
    email: 'benchmark.customer.8@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 8',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000309',
    email: 'benchmark.customer.9@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 9',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000310',
    email: 'benchmark.customer.10@test.local',
    firstName: 'Benchmark',
    lastName: 'Customer 10',
  },
] as const;

function appointmentSlotKey(staffId: string, startUtc: Date): string {
  const ymd = formatBusinessTime(startUtc, BENCHMARK_FIXTURE.timezone, 'yyyy-MM-dd');
  const wall = formatBusinessTime(startUtc, BENCHMARK_FIXTURE.timezone, 'HH:mm');
  return `${BUSINESS_ID}:${staffId}:${ymd}:${wall}`;
}

function deterministicAppointmentId(dayIndex: number, staffIndex: number): string {
  const serial = 700 + dayIndex * 10 + staffIndex;
  return `a0000001-0000-4000-8000-${String(serial).padStart(12, '0')}`;
}

async function ensureOwnerMembership() {
  const ownerRole = await prisma.role.findFirst({
    where: { slug: 'owner', businessId: null, isSystem: true },
    select: { id: true },
  });
  if (!ownerRole) {
    throw new Error('Owner role was not found while seeding deterministic fixture');
  }

  const ownerUser = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    create: {
      email: OWNER_EMAIL,
      firstName: 'Fuad',
      lastName: 'Sami',
      authProvider: 'google',
      emailVerified: true,
      isActive: true,
    },
    update: {
      firstName: 'Fuad',
      lastName: 'Sami',
      authProvider: 'google',
      emailVerified: true,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  await prisma.businessUser.upsert({
    where: {
      businessId_userId: {
        businessId: BUSINESS_ID,
        userId: ownerUser.id,
      },
    },
    create: {
      businessId: BUSINESS_ID,
      userId: ownerUser.id,
      roleId: ownerRole.id,
      isActive: true,
    },
    update: {
      roleId: ownerRole.id,
      isActive: true,
    },
  });
}

async function main() {
  if (BUSINESS_ID !== BENCHMARK_FIXTURE.businessId) {
    throw new Error(
      `BUSINESS_ID must be ${BENCHMARK_FIXTURE.businessId} for deterministic benchmark fixture`,
    );
  }

  await reseedBenchmarkFixture(prisma);
  await ensureOwnerMembership();

  const seededYmds = Array.from({ length: 7 }, (_, dayIndex) =>
    DateTime.fromISO(`${SEEDED_DATE_FROM}T00:00:00`, {
      zone: BENCHMARK_FIXTURE.timezone,
    })
      .plus({ days: dayIndex })
      .toFormat('yyyy-MM-dd'),
  );

  const seededDateFrom = SEEDED_DATE_FROM;
  const seededDateTo = SEEDED_DATE_TO;

  const windowStartUtc = DateTime.fromISO(`${seededDateFrom}T00:00:00`, {
    zone: BENCHMARK_FIXTURE.timezone,
  }).toUTC().toJSDate();
  const windowEndUtc = DateTime.fromISO(`${seededDateTo}T00:00:00`, {
    zone: BENCHMARK_FIXTURE.timezone,
  })
    .plus({ days: 1 })
    .toUTC()
    .toJSDate();

  const staffIds = BENCHMARK_FIXTURE.staff.map((staff) => staff.id);
  const serviceIds = BENCHMARK_FIXTURE.services.map((service) => service.id);
  const customerIds = DETERMINISTIC_CUSTOMERS.map((customer) => customer.id);

  const seededAppointments: Array<{
    id: string;
    businessId: string;
    branchId: string;
    customerId: string;
    staffId: string;
    serviceId: string;
    startTime: Date;
    endTime: Date;
    status: AppointmentStatus;
    slotKey: string;
  }> = [];

  const appointmentTemplate: Array<{ start: string; end: string; serviceIndex: number; customerIndex: number }> = [
    { start: '10:00', end: '10:25', serviceIndex: 0, customerIndex: 0 },
    { start: '11:00', end: '11:45', serviceIndex: 1, customerIndex: 1 },
    { start: '15:00', end: '15:25', serviceIndex: 0, customerIndex: 2 },
  ];

  seededYmds.forEach((ymd, dayIndex) => {
    BENCHMARK_FIXTURE.staff.forEach((staff, staffIndex) => {
      const template = appointmentTemplate[staffIndex % appointmentTemplate.length];
      const startUtc = toUtcFromBusinessHhmm(
        ymd,
        template.start,
        BENCHMARK_FIXTURE.timezone,
      );
      const endUtc = toUtcFromBusinessHhmm(
        ymd,
        template.end,
        BENCHMARK_FIXTURE.timezone,
      );
      seededAppointments.push({
        id: deterministicAppointmentId(dayIndex, staffIndex + 1),
        businessId: BUSINESS_ID,
        branchId: BENCHMARK_FIXTURE.branchId,
        customerId:
          DETERMINISTIC_CUSTOMERS[
            (template.customerIndex + dayIndex) % DETERMINISTIC_CUSTOMERS.length
          ].id,
        staffId: staff.id,
        serviceId: BENCHMARK_FIXTURE.services[template.serviceIndex].id,
        startTime: startUtc,
        endTime: endUtc,
        status: AppointmentStatus.CONFIRMED,
        slotKey: appointmentSlotKey(staff.id, startUtc),
      });
    });
  });

  await prisma.$transaction(
    async (tx) => {
      await tx.staffWorkingHoursDateOverride.deleteMany({
        where: {
          staffId: { in: staffIds },
          date: {
            gte: new Date(`${seededDateFrom}T00:00:00.000Z`),
            lte: new Date(`${seededDateTo}T00:00:00.000Z`),
          },
        },
      });

      await tx.staffBreakException.deleteMany({
        where: {
          staffId: { in: staffIds },
          date: {
            gte: new Date(`${seededDateFrom}T00:00:00.000Z`),
            lte: new Date(`${seededDateTo}T00:00:00.000Z`),
          },
        },
      });

      await tx.staffTimeOff.deleteMany({
        where: {
          staffId: { in: staffIds },
          startDate: { lt: windowEndUtc },
          endDate: { gt: windowStartUtc },
        },
      });

      await tx.appointment.deleteMany({
        where: {
          businessId: BUSINESS_ID,
          startTime: { gte: windowStartUtc, lt: windowEndUtc },
        },
      });

      await tx.customer.deleteMany({
        where: {
          businessId: BUSINESS_ID,
          id: { notIn: customerIds },
        },
      });

      for (const customer of DETERMINISTIC_CUSTOMERS) {
        await tx.customer.upsert({
          where: { id: customer.id },
          create: {
            id: customer.id,
            businessId: BUSINESS_ID,
            branchId: BENCHMARK_FIXTURE.branchId,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            isActive: true,
          },
          update: {
            businessId: BUSINESS_ID,
            branchId: BENCHMARK_FIXTURE.branchId,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            isActive: true,
            deletedAt: null,
          },
        });
      }

      await tx.staffWorkingHoursDateOverride.createMany({
        data: seededYmds.flatMap((ymd) =>
          staffIds.map((staffId) => ({
            staffId,
            date: new Date(`${ymd}T00:00:00.000Z`),
            isClosed: false,
            startTime: '09:00',
            endTime: '18:00',
          })),
        ),
      });

      await tx.appointment.createMany({
        data: seededAppointments,
      });
    },
    { maxWait: 60_000, timeout: 300_000 },
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const timeSlots = app.get(TimeSlotService);
    for (const staffId of staffIds) {
      for (const ymd of seededYmds) {
        await timeSlots.regenerateDay(
          BUSINESS_ID,
          staffId,
          ymd,
          BENCHMARK_FIXTURE.timezone,
        );
      }
    }
  } finally {
    await app.close();
  }

  const targetStaffId = staffIds[0];
  const freeSlotsOnTargetDate = await prisma.timeSlot.findMany({
    where: {
      businessId: BUSINESS_ID,
      staffId: targetStaffId,
      date: new Date(`${TARGET_TEST_DATE}T00:00:00.000Z`),
      status: 'free',
    },
    select: { startTime: true },
    orderBy: { startTime: 'asc' },
  });
  const firstFreeSlot = freeSlotsOnTargetDate[0]?.startTime ?? null;
  const lastFreeSlot =
    freeSlotsOnTargetDate[freeSlotsOnTargetDate.length - 1]?.startTime ?? null;

  console.log(
    JSON.stringify({
      businessId: BUSINESS_ID,
      seededDateFrom,
      seededDateTo,
      customerCount: customerIds.length,
      staffIds,
      serviceIds,
      customerIds,
      seededAppointmentIds: seededAppointments.map((appointment) => appointment.id),
      targetTestDate: TARGET_TEST_DATE,
      expectedAvailableSlotGuarantee: {
        staffId: targetStaffId,
        minimumFreeSlotsOnTargetDate: freeSlotsOnTargetDate.length,
        firstFreeSlot,
        lastFreeSlot,
      },
      note: 'Deterministic fixed-window fixture for k6/time-edge manual runs.',
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
