import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { RedisModule } from '../../src/redis/redis.module';
import { AvailabilityModule } from '../../src/availability/availability.module';
import { TimeSlotProjectionLifecycleService } from '../../src/availability/time-slot-projection-lifecycle.service';

type CliArgs = {
  businessId?: string;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AvailabilityModule,
  ],
})
class ProjectionCliModule {}

function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (const raw of argv) {
    const arg = raw.trim();
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    const v = rest.join('=').trim();
    if (!v) continue;
    if (k === 'businessId') out.businessId = v;
    if (k === 'staffId') out.staffId = v;
    if (k === 'fromDate') out.fromDate = v;
    if (k === 'toDate') out.toDate = v;
  }
  return out;
}

function printUsage(): void {
  console.log(
    'Usage: npm run projection:regenerate -- --businessId=<uuid> [--staffId=<uuid>] [--fromDate=YYYY-MM-DD] [--toDate=YYYY-MM-DD]',
  );
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.businessId) {
    printUsage();
    throw new Error('businessId is required');
  }

  const triggerReason = 'manual_script:projection_regenerate';
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      type: 'TIME_SLOT_PROJECTION_REGENERATE_START',
      businessId: args.businessId,
      staffId: args.staffId ?? null,
      fromDate: args.fromDate ?? null,
      toDate: args.toDate ?? null,
      triggerReason,
    }),
  );

  const app = await NestFactory.createApplicationContext(ProjectionCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const lifecycle = app.get(TimeSlotProjectionLifecycleService);
    const summary = await lifecycle.regenerateBusinessWindow({
      businessId: args.businessId,
      staffId: args.staffId,
      fromDate: args.fromDate,
      toDate: args.toDate,
      reason: triggerReason,
    });

    console.log('PROJECTION_REGENERATE_RESULT:');
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      JSON.stringify({
        type: 'TIME_SLOT_PROJECTION_REGENERATE_FINISH',
        businessId: summary.businessId,
        staffId: summary.staffId ?? null,
        fromDate: summary.fromDate,
        toDate: summary.toDate,
        generatedRows: summary.generatedRows,
        deletedRows: summary.deletedRows,
        durationMs: summary.durationMs,
        staffCount: summary.staffCount,
        triggerReason: summary.triggerReason,
        scriptDurationMs: Date.now() - startedAt,
      }),
    );
  } finally {
    await app.close();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
