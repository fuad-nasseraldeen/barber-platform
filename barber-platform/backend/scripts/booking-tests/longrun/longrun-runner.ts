#!/usr/bin/env ts-node
/**
 * Long-running consistency test: random operations for N seconds, then full invariant sweep.
 *
 *   npm run test:booking:longrun
 *
 * Env: BUSINESS_ID, AUTH_TOKEN, DATABASE_URL, BASE_URL
 *   LONGRUN_SECONDS (default 60, max 600)
 *   LONGRUN_OPS_PER_SEC (default 2)
 */
import { loadBackendEnv, intEnv, mintLongLivedTestToken } from '../lib/env';
import { createScriptPrisma } from '../lib/prisma-script';
import { runInvariantSuite } from '../invariants/suite';
import { printInvariantReport } from '../lib/report';
import {
  resolveFixture,
  blockMinutesFor,
  findDateWithSlots,
  getAvailability,
  parseAvailabilitySlots,
  createSlotHold,
  bookAppointment,
  cancelAppointment,
  type BookingApiOpts,
  type Fixture,
} from '../lib/booking-api';

loadBackendEnv();

const DURATION_SEC = Math.min(600, intEnv('LONGRUN_SECONDS', 60));
const OPS_PER_SEC = Math.max(1, intEnv('LONGRUN_OPS_PER_SEC', 2));

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const businessId = (
    process.env.BUSINESS_ID ??
    process.env.TEST_BUSINESS_ID ??
    ''
  ).trim();
  const rawToken = (process.env.AUTH_TOKEN ?? process.env.K6_AUTH_TOKEN ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '');
  const authToken = mintLongLivedTestToken(rawToken);
  const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').trim();
  const apiPrefix = (process.env.API_PREFIX || 'api/v1').trim();
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!businessId) throw new Error('BUSINESS_ID required');
  if (!authToken) throw new Error('AUTH_TOKEN required');
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  const api: BookingApiOpts = { baseUrl, apiPrefix, authToken };
  const prisma = createScriptPrisma(databaseUrl);
  const fx = await resolveFixture(api, businessId);

  console.log(`\n=== LONG-RUN CONSISTENCY TEST ===`);
  console.log(`duration: ${DURATION_SEC}s  opsPerSec: ${OPS_PER_SEC}`);
  console.log(
    `staff=${fx.staffId.slice(0, 8)} services=${fx.serviceIds.length} customers=${fx.customerIds.length}\n`,
  );

  const liveAppointments = new Set<string>();
  const stats = { holds: 0, books: 0, cancels: 0, conflicts: 0, errors: 0 };

  const start = Date.now();
  const endAt = start + DURATION_SEC * 1000;
  const interval = 1000 / OPS_PER_SEC;
  let lastInvariantCheck = start;

  while (Date.now() < endAt) {
    const opStart = Date.now();

    try {
      const serviceId = pickRandom(fx.serviceIds);
      const customerId = pickRandom(fx.customerIds);
      const block = blockMinutesFor(fx, fx.staffId, serviceId);

      // Decide: cancel existing or create new
      const doCancelExisting =
        liveAppointments.size > 0 && Math.random() < 0.3;

      if (doCancelExisting) {
        const aptId = pickRandom([...liveAppointments]);
        const res = await cancelAppointment(api, {
          appointmentId: aptId,
          businessId,
          reason: 'longrun cleanup',
        });
        if (res.status === 200 || res.status === 201) {
          liveAppointments.delete(aptId);
          stats.cancels++;
        }
      } else {
        const dateResult = await findDateWithSlots(
          api,
          businessId,
          fx.staffId,
          serviceId,
          1,
          14,
        );
        if (!dateResult) continue;

        const slot =
          dateResult.slots[
            Math.floor(Math.random() * dateResult.slots.length)
          ];

        const holdRes = await createSlotHold(api, {
          businessId,
          staffId: fx.staffId,
          serviceId,
          customerId,
          date: dateResult.dateYmd,
          startTime: slot,
          durationMinutes: block,
        });

        if (holdRes.status === 409) {
          stats.conflicts++;
        } else if (
          (holdRes.status === 200 || holdRes.status === 201) &&
          holdRes.holdId
        ) {
          stats.holds++;

          // 70% of holds proceed to book
          if (Math.random() < 0.7) {
            const bookRes = await bookAppointment(api, {
              businessId,
              slotHoldId: holdRes.holdId,
            });
            if (
              (bookRes.status === 200 || bookRes.status === 201) &&
              bookRes.appointmentId
            ) {
              stats.books++;
              liveAppointments.add(bookRes.appointmentId);
            }
          }
        } else {
          stats.errors++;
        }
      }
    } catch (e) {
      stats.errors++;
      console.warn(`op error: ${(e as Error).message}`);
    }

    // Periodic DB invariant check (every 10s)
    if (Date.now() - lastInvariantCheck > 10_000) {
      const suite = await runInvariantSuite({
        prisma,
        businessId,
        skipAvailabilityHttp: true,
      });
      if (!suite.ok) {
        console.error('\nINVARIANT VIOLATION DURING LONG-RUN:');
        printInvariantReport(suite);
      } else {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(
          `  [${elapsed}s] holds=${stats.holds} books=${stats.books} cancels=${stats.cancels} conflicts=${stats.conflicts} live=${liveAppointments.size} — DB OK`,
        );
      }
      lastInvariantCheck = Date.now();
    }

    // Rate limit
    const opDur = Date.now() - opStart;
    if (opDur < interval) {
      await sleep(interval - opDur);
    }
  }

  // Clean up: cancel all live appointments
  console.log(`\nCleaning up ${liveAppointments.size} live appointments...`);
  for (const aptId of liveAppointments) {
    try {
      await cancelAppointment(api, {
        appointmentId: aptId,
        businessId,
        reason: 'longrun cleanup',
      });
    } catch {
      // best effort
    }
  }

  // Final invariant sweep
  console.log(`\nFinal invariant sweep...`);
  const dateInfo = await findDateWithSlots(
    api,
    businessId,
    fx.staffId,
    fx.serviceIds[0],
    1,
  );
  const finalResult = await runInvariantSuite({
    prisma,
    businessId,
    skipAvailabilityHttp: !dateInfo,
    httpOpts: dateInfo
      ? {
          baseUrl,
          apiPrefix,
          authToken,
          staffId: fx.staffId,
          serviceId: fx.serviceIds[0],
          dateYmd: dateInfo.dateYmd,
          blockMinutes: blockMinutesFor(fx, fx.staffId, fx.serviceIds[0]),
          businessTimezone: fx.businessTimezone,
        }
      : undefined,
  });
  printInvariantReport(finalResult);

  console.log(`\n=== LONG-RUN SUMMARY ===`);
  console.log(`duration: ${Math.round((Date.now() - start) / 1000)}s`);
  console.log(
    `holds: ${stats.holds}  books: ${stats.books}  cancels: ${stats.cancels}  conflicts: ${stats.conflicts}  errors: ${stats.errors}`,
  );
  console.log(`RESULT: ${finalResult.ok ? 'PASS' : 'FAIL'}`);
  console.log(`========================\n`);

  await prisma.$disconnect();
  process.exit(finalResult.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
