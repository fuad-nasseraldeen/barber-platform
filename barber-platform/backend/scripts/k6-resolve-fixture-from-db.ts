/**
 * Resolve k6 fixture IDs from PostgreSQL using BUSINESS_ID only.
 *
 * Usage (from barber-platform/backend/):
 *   BUSINESS_ID=<uuid> ts-node scripts/k6-resolve-fixture-from-db.ts
 *   ts-node scripts/k6-resolve-fixture-from-db.ts --businessId=<uuid>
 *
 * Prints one JSON line to stdout (last line): staffIds, serviceIds, customerIds, k6ServiceDurations.
 * Logs / errors go to stderr. Exit 1 if business missing or no staff/services/customers.
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

const cwd = resolve(__dirname, '..');
for (const name of ['.env', '.env.local'] as const) {
  const p = resolve(cwd, name);
  if (existsSync(p)) {
    config({ path: p, override: name === '.env.local' });
  }
}

function databaseUrlForScript(): string {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required (backend/.env)');
  }
  const limit = Math.max(
    1,
    parseInt(process.env.K6_FIXTURE_DB_CONNECTION_LIMIT || '1', 10) || 1,
  );
  if (/connection_limit=/i.test(dbUrl)) {
    return dbUrl.replace(/connection_limit=\d+/i, `connection_limit=${limit}`);
  }
  const joiner = dbUrl.includes('?') ? '&' : '?';
  return `${dbUrl}${joiner}connection_limit=${limit}&pool_timeout=20`;
}

function parseBusinessId(): string {
  const fromEnv = (
    process.env.BUSINESS_ID ||
    process.env.TEST_BUSINESS_ID ||
    ''
  ).trim();
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--businessId=')) {
      return a.slice('--businessId='.length).trim();
    }
  }
  const idx = process.argv.indexOf('--businessId');
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1].trim();
  }
  return fromEnv;
}

function effectiveBookMinutesForService(s: {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  staffServices: { durationMinutes: number }[];
}): number {
  const buf =
    (s.bufferBeforeMinutes ?? 0) + (s.bufferAfterMinutes ?? 0);
  if (!s.staffServices.length) {
    return s.durationMinutes + buf;
  }
  const perStaff = s.staffServices.map((ss) => ss.durationMinutes + buf);
  return Math.max(...perStaff, s.durationMinutes + buf);
}

async function main() {
  const businessId = parseBusinessId();
  if (!businessId) {
    console.error(
      'Missing BUSINESS_ID. Set env or pass --businessId=<uuid>',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrlForScript() } },
  });

  try {
    const business = await prisma.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!business) {
      console.error(
        `Business not found: id=${businessId} (missing or deleted).`,
      );
      process.exit(1);
    }
    console.error(`# k6 fixture: business "${business.name}" (${business.id})`);

    const staffRows = await prisma.staff.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    const staffIds = staffRows.map((s) => s.id);

    const serviceRows = await prisma.service.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
      },
      include: {
        staffServices: {
          where: {
            allowBooking: true,
            staff: { businessId, deletedAt: null, isActive: true },
          },
          select: { durationMinutes: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 50,
    });
    const serviceIds = serviceRows.map((s) => s.id);
    const k6ServiceDurations = serviceRows
      .map((s) => {
        const mins = effectiveBookMinutesForService(s);
        return `${s.id}:${mins}`;
      })
      .join(',');

    const customerRows = await prisma.customer.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const customerIds = customerRows.map((c) => c.id);

    if (staffIds.length === 0) {
      console.error(
        'No active staff for this business. Seed staff or activate existing rows.',
      );
      process.exit(1);
    }
    if (serviceIds.length === 0) {
      console.error(
        'No active services for this business. Seed services or activate existing rows.',
      );
      process.exit(1);
    }
    if (customerIds.length === 0) {
      console.error(
        'No active customers for this business. Run e.g. npm run prisma:seed-demo or create customers.',
      );
      process.exit(1);
    }

    process.stdout.write(
      `${JSON.stringify({
        staffIds,
        serviceIds,
        customerIds,
        k6ServiceDurations,
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
