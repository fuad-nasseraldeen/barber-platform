/**
 * Run after k6 load tests to prove correctness under chaos (not latency alone).
 *
 * Usage (from backend/, DATABASE_URL in .env):
 *   npm run post-k6-checks
 *   npm run post-k6-checks -- --businessId=<uuid>   # scope duplicate scan to one tenant
 *
 * Exit code 1 if: double-active bookings for same (staff, start).
 */

import { PrismaClient } from '@prisma/client';

/**
 * Supabase Session pooler (:5432) caps concurrent clients (MaxClientsInSessionMode).
 * This script overrides the pool to 1 so it can run while the API still holds slots.
 * Override: POST_K6_DB_CONNECTION_LIMIT=2
 */
function databaseUrlForScript(): string {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required (load .env from backend/)');
  }
  const limit = Math.max(
    1,
    parseInt(process.env.POST_K6_DB_CONNECTION_LIMIT || '1', 10) || 1,
  );
  if (/connection_limit=/i.test(dbUrl)) {
    return dbUrl.replace(/connection_limit=\d+/i, `connection_limit=${limit}`);
  }
  const joiner = dbUrl.includes('?') ? '&' : '?';
  return `${dbUrl}${joiner}connection_limit=${limit}&pool_timeout=20`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrlForScript(),
    },
  },
});

function argBusinessId(): string | undefined {
  const a = process.argv.find((x) => x.startsWith('--businessId='));
  return a ? a.slice('--businessId='.length).trim() || undefined : undefined;
}

async function main() {
  const businessId =
    argBusinessId() ||
    process.env.BUSINESS_ID ||
    process.env.TEST_BUSINESS_ID ||
    undefined;

  console.log('\n=== post-k6 DB checks ===');
  if (businessId) {
    console.log(`Scoped to businessId=${businessId.slice(0, 8)}…`);
  } else {
    console.log('Full-database scan (set BUSINESS_ID or --businessId= to narrow)');
  }

  const dupes = businessId
    ? await prisma.$queryRaw<
        Array<{ staffId: string; startTime: Date; cnt: number }>
      >`
      SELECT "staffId", "startTime", COUNT(*)::int AS cnt
      FROM appointments
      WHERE "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND "businessId" = ${businessId}
      GROUP BY "staffId", "startTime"
      HAVING COUNT(*) > 1
    `
    : await prisma.$queryRaw<
        Array<{ staffId: string; startTime: Date; cnt: number }>
      >`
      SELECT "staffId", "startTime", COUNT(*)::int AS cnt
      FROM appointments
      WHERE "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
      GROUP BY "staffId", "startTime"
      HAVING COUNT(*) > 1
    `;

  console.log('\n--- Double booking (must be 0 rows) ---');
  let bad = false;
  if (dupes.length === 0) {
    console.log('OK: no duplicate active appointments for same staffId + startTime');
  } else {
    bad = true;
    console.error('FAIL: duplicate active slots:');
    for (const r of dupes) {
      console.error(
        `  staffId=${r.staffId} startTime=${r.startTime.toISOString()} count=${r.cnt}`,
      );
    }
  }

  console.log(bad ? '\nRESULT: FAIL\n' : '\nRESULT: PASS\n');
  await prisma.$disconnect();
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
