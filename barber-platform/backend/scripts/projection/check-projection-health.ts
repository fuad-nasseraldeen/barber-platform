import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  addBusinessDaysFromYmd,
  resolveScheduleWallClockZone,
} from '../../src/common/business-local-time';
import { ensureValidBusinessZone } from '../../src/common/time-engine';

type CliArgs = {
  businessId?: string;
};

type StaffDateCountRow = {
  staffId: string;
  ymd: string;
  count: number;
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class ProjectionHealthCliModule {}

function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (const raw of argv) {
    const arg = raw.trim();
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    const v = rest.join('=').trim();
    if (!v) continue;
    if (k === 'businessId') out.businessId = v;
  }
  return out;
}

function printUsage(): void {
  console.log('Usage: npm run projection:health -- --businessId=<uuid>');
}

function parseBookingWindowDays(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '14', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 14;
  return parsed;
}

function buildWindowDates(startYmd: string, timeZone: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addBusinessDaysFromYmd(timeZone, startYmd, i));
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.businessId) {
    printUsage();
    throw new Error('businessId is required');
  }

  const app = await NestFactory.createApplicationContext(ProjectionHealthCliModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const bookingWindowDays = parseBookingWindowDays(process.env.BOOKING_WINDOW_DAYS);

    const business = await prisma.business.findUnique({
      where: { id: args.businessId },
      select: { id: true, timezone: true },
    });
    if (!business) {
      throw new Error(`Business not found: ${args.businessId}`);
    }

    const timeZone = ensureValidBusinessZone(
      resolveScheduleWallClockZone(business.timezone),
    );
    const startYmd = DateTime.now().setZone(timeZone).toISODate();
    if (!startYmd) {
      throw new Error('Could not derive business-local start date');
    }
    const endExclusiveYmd = addBusinessDaysFromYmd(
      timeZone,
      startYmd,
      bookingWindowDays,
    );
    const windowDates = buildWindowDates(startYmd, timeZone, bookingWindowDays);

    const staffRows = await prisma.staff.findMany({
      where: {
        businessId: args.businessId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const staffIds = staffRows.map((row) => row.id);

    const startDate = new Date(startYmd);
    const endDateExclusive = new Date(endExclusiveYmd);

    const rows = await prisma.$queryRaw<Array<StaffDateCountRow>>`
      SELECT
        "staff_id" AS "staffId",
        to_char("date", 'YYYY-MM-DD') AS "ymd",
        COUNT(*)::int AS "count"
      FROM "time_slots"
      WHERE "business_id" = ${args.businessId}
        AND "date" >= ${startDate}
        AND "date" < ${endDateExclusive}
      GROUP BY "staff_id", "date"
    `;

    const countMap = new Map<string, number>();
    let totalProjectedRows = 0;
    for (const row of rows) {
      const cnt = Number(row.count) || 0;
      totalProjectedRows += cnt;
      countMap.set(`${row.staffId}:${row.ymd}`, cnt);
    }

    const datesMissingProjectionRows: string[] = [];
    for (const ymd of windowDates) {
      const hasAnyForDate = rows.some((row) => row.ymd === ymd && Number(row.count) > 0);
      if (!hasAnyForDate) datesMissingProjectionRows.push(ymd);
    }

    const staffMissingProjectedSlots: Array<{ staffId: string; dateYmd: string }> = [];
    for (const staffId of staffIds) {
      for (const ymd of windowDates) {
        const cnt = countMap.get(`${staffId}:${ymd}`) ?? 0;
        if (cnt <= 0) {
          staffMissingProjectedSlots.push({ staffId, dateYmd: ymd });
        }
      }
    }

    const report = {
      type: 'PROJECTION_HEALTH_REPORT',
      businessId: args.businessId,
      businessTimezone: timeZone,
      bookingWindowDays,
      windowStartYmd: startYmd,
      windowEndExclusiveYmd: endExclusiveYmd,
      activeStaffCount: staffIds.length,
      totalProjectedRows,
      datesMissingProjectionRows,
      staffMissingProjectedSlots,
      hasGaps:
        datesMissingProjectionRows.length > 0 ||
        staffMissingProjectedSlots.length > 0 ||
        staffIds.length === 0,
    };

    console.log(JSON.stringify(report, null, 2));

    if (report.hasGaps) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
