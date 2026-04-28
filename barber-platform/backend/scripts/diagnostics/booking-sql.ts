import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class DiagBookingSqlModule {}

async function explain(prisma: PrismaService, name: string, sql: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${sql}`,
  );
  console.log(`\n=== ${name} ===`);
  for (const row of rows) {
    const line = row['QUERY PLAN'] ?? Object.values(row)[0];
    console.log(line);
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(DiagBookingSqlModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const businessId = process.env.BUSINESS_ID ?? 'a0000001-0000-4000-8000-000000000001';
    const staffId = process.env.DIAG_STAFF_ID ?? 'a0000001-0000-4000-8000-000000000003';
    const serviceId = process.env.DIAG_SERVICE_ID ?? 'a0000001-0000-4000-8000-000000000015';

    const hold = await prisma.slotHold.findFirst({
      where: { businessId, staffId, serviceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, startTime: true, endTime: true },
    });
    const fallbackStart = new Date(Date.now() + 60 * 60 * 1000);
    const fallbackEnd = new Date(fallbackStart.getTime() + 15 * 60 * 1000);
    const startTime = hold?.startTime ?? fallbackStart;
    const endTime = hold?.endTime ?? fallbackEnd;
    const holdId = hold?.id ?? '';
    const slotDate = startTime.toISOString().slice(0, 10);
    const startHhmm = startTime.toISOString().slice(11, 16);
    const endHhmm = endTime.toISOString().slice(11, 16);
    const startMin = Number(startHhmm.slice(0, 2)) * 60 + Number(startHhmm.slice(3, 5));
    const endMin = Number(endHhmm.slice(0, 2)) * 60 + Number(endHhmm.slice(3, 5));
    const durationMinutes = Math.max(1, endMin - startMin);

    console.log(
      JSON.stringify(
        {
          type: 'DIAG_BOOKING_SQL',
          businessId,
          staffId,
          serviceId,
          holdId: holdId || null,
          slotDate,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
        null,
        2,
      ),
    );

    await explain(
      prisma,
      'Appointment overlap check equivalent',
      `
      SELECT id
      FROM appointments
      WHERE "businessId" = '${businessId}'
        AND "staffId" = '${staffId}'
        AND status <> 'CANCELLED'
        AND "startTime" < '${endTime.toISOString()}'::timestamptz
        AND "endTime" > '${startTime.toISOString()}'::timestamptz
      LIMIT 50
      `,
    );

    await explain(
      prisma,
      'Slot hold lookup FOR UPDATE',
      `
      SELECT id, business_id, staff_id, start_time, end_time, consumed_at, expires_at
      FROM slot_holds
      WHERE id = '${holdId}'
      FOR UPDATE
      `,
    );

    await explain(
      prisma,
      'Slot hold consume update equivalent',
      `
      UPDATE slot_holds
      SET consumed_at = now()
      WHERE id = '${holdId}'
        AND 1 = 0
      `,
    );

    await explain(
      prisma,
      'Appointment lookup by staff/date',
      `
      SELECT id, "startTime", "endTime", status
      FROM appointments
      WHERE "businessId" = '${businessId}'
        AND "staffId" = '${staffId}'
        AND "startTime" >= '${slotDate}T00:00:00.000Z'::timestamptz
        AND "startTime" < ('${slotDate}T00:00:00.000Z'::timestamptz + interval '1 day')
      ORDER BY "startTime" ASC
      LIMIT 200
      `,
    );

    await explain(
      prisma,
      'Time slot delete related',
      `
      DELETE FROM time_slots
      WHERE business_id = '${businessId}'
        AND staff_id = '${staffId}'
        AND date = '${slotDate}'::date
        AND start_time >= '${startHhmm}'
        AND start_time < '${endHhmm}'
        AND 1 = 0
      `,
    );

    await explain(
      prisma,
      'Time slot create related (plan only)',
      `
      INSERT INTO time_slots (business_id, staff_id, date, start_time, end_min, duration_minutes, status, hold_id, appointment_id)
      SELECT
        '${businessId}',
        '${staffId}',
        '${slotDate}'::date,
        '${startHhmm}',
        ${endMin},
        ${durationMinutes},
        'booked',
        NULL,
        '00000000-0000-0000-0000-000000000000'
      WHERE 1 = 0
      `,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
