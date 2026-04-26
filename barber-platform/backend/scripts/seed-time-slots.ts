/**
 * One-off: populate time_slots table for all active staff, N days ahead.
 * Run: npx ts-node scripts/seed-time-slots.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TimeSlotService } from '../src/availability/time-slot.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const timeSlots = app.get(TimeSlotService);

  const businesses = await prisma.business.findMany({
    select: { id: true, timezone: true },
  });

  for (const biz of businesses) {
    const tz = biz.timezone || 'Asia/Jerusalem';
    console.log(`Seeding time_slots for business ${biz.id} (tz: ${tz})...`);
    const result = await timeSlots.seedBusinessDays(biz.id, tz, 14);
    console.log(`  → ${result.staffCount} staff, ${result.totalInserted} slots inserted`);
  }

  await app.close();
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
