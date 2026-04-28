import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class DiagDbSchemaModule {}

async function queryRows(prisma: PrismaService, sql: string): Promise<Array<Record<string, unknown>>> {
  return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
}

async function main() {
  const app = await NestFactory.createApplicationContext(DiagDbSchemaModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);

    const appointmentIndexes = await queryRows(
      prisma,
      `
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'appointments'
      ORDER BY indexname
      `,
    );
    const slotHoldIndexes = await queryRows(
      prisma,
      `
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'slot_holds'
      ORDER BY indexname
      `,
    );
    const timeSlotIndexes = await queryRows(
      prisma,
      `
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'time_slots'
      ORDER BY indexname
      `,
    );
    const appointmentConstraints = await queryRows(
      prisma,
      `
      SELECT conname, contype, pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'appointments'
      ORDER BY conname
      `,
    );
    const appointmentTriggers = await queryRows(
      prisma,
      `
      SELECT trigger_name, event_manipulation, action_timing, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'appointments'
      ORDER BY trigger_name
      `,
    );
    const appointmentAndSlotHoldFks = await queryRows(
      prisma,
      `
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND (tc.table_name IN ('appointments', 'slot_holds')
             OR ccu.table_name IN ('appointments', 'slot_holds'))
      ORDER BY tc.table_name, tc.constraint_name
      `,
    );

    console.log(
      JSON.stringify(
        {
          type: 'DIAG_DB_SCHEMA',
          appointmentIndexes,
          slotHoldIndexes,
          timeSlotIndexes,
          appointmentConstraints,
          appointmentTriggers,
          appointmentAndSlotHoldFks,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
