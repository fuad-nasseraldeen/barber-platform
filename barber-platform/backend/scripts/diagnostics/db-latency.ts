import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildStats, measureOne, printSection } from './_diag-helpers';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class DiagDbLatencyModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(DiagDbLatencyModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const businessId = process.env.BUSINESS_ID;

    const sequential: number[] = [];
    for (let i = 0; i < 20; i++) {
      const { ms } = await measureOne(() => prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`);
      sequential.push(ms);
    }

    const concurrent = await Promise.all(
      Array.from({ length: 20 }).map(async () => {
        const { ms } = await measureOne(() =>
          prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`,
        );
        return ms;
      }),
    );

    const simpleBusiness: number[] = [];
    const simpleStaff: number[] = [];
    const simpleSlotHold: number[] = [];
    const simpleAppointment: number[] = [];
    for (let i = 0; i < 10; i++) {
      simpleBusiness.push(
        (
          await measureOne(() =>
            prisma.business.findFirst({
              where: businessId ? { id: businessId } : undefined,
              select: { id: true },
            }),
          )
        ).ms,
      );
      simpleStaff.push(
        (
          await measureOne(() =>
            prisma.staff.findFirst({
              where: businessId ? { businessId } : undefined,
              select: { id: true },
            }),
          )
        ).ms,
      );
      simpleSlotHold.push(
        (
          await measureOne(() =>
            prisma.slotHold.findFirst({
              where: businessId ? { businessId } : undefined,
              select: { id: true },
            }),
          )
        ).ms,
      );
      simpleAppointment.push(
        (
          await measureOne(() =>
            prisma.appointment.findFirst({
              where: businessId ? { businessId } : undefined,
              select: { id: true },
            }),
          )
        ).ms,
      );
    }

    console.log(JSON.stringify({ type: 'DIAG_DB_LATENCY', businessId: businessId ?? null }, null, 2));
    printSection('SELECT 1 sequential x20', buildStats(sequential));
    printSection('SELECT 1 concurrent x20', buildStats(concurrent));
    printSection('Business.findFirst x10', buildStats(simpleBusiness));
    printSection('Staff.findFirst x10', buildStats(simpleStaff));
    printSection('SlotHold.findFirst x10', buildStats(simpleSlotHold));
    printSection('Appointment.findFirst x10', buildStats(simpleAppointment));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
