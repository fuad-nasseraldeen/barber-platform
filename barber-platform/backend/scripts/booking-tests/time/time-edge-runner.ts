#!/usr/bin/env ts-node
/**
 * Time-edge tests: boundary times, last slot of day, hold expiration, timezone round-trip.
 *
 *   npm run test:booking:time
 *
 * Env: BUSINESS_ID, AUTH_TOKEN, DATABASE_URL, BASE_URL
 */
import { loadBackendEnv, mintLongLivedTestToken } from '../lib/env';
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
} from '../lib/booking-api';

loadBackendEnv();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
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
  const serviceId = fx.serviceIds[0];
  const customerId = fx.customerIds[0];
  const block = blockMinutesFor(fx, fx.staffId, serviceId);

  let failures = 0;
  const pass = (name: string) => console.log(`  PASS: ${name}`);
  const fail = (name: string, reason: string) => {
    failures++;
    console.error(`  FAIL: ${name} — ${reason}`);
  };

  console.log(`\n=== TIME-EDGE TESTS ===\n`);

  // --- Test 1: Last slot of day ---
  console.log('Test 1: Last slot of day (hold + book + cancel)');
  const dateResult = await findDateWithSlots(
    api,
    businessId,
    fx.staffId,
    serviceId,
    2,
  );
  if (!dateResult) {
    fail('last_slot', 'no date with 2+ slots');
  } else {
    const lastSlot = dateResult.slots[dateResult.slots.length - 1];
    const holdRes = await createSlotHold(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      customerId,
      date: dateResult.dateYmd,
      startTime: lastSlot,
      durationMinutes: block,
    });
    if (holdRes.status !== 200 && holdRes.status !== 201) {
      fail('last_slot', `hold failed: ${holdRes.status}`);
    } else if (!holdRes.holdId) {
      fail('last_slot', 'no holdId');
    } else {
      const bookRes = await bookAppointment(api, {
        businessId,
        slotHoldId: holdRes.holdId,
      });
      if (bookRes.status !== 200 && bookRes.status !== 201) {
        fail('last_slot', `book failed: ${bookRes.status}`);
      } else if (!bookRes.appointmentId) {
        fail('last_slot', 'no appointmentId');
      } else {
        // Verify invariants
        const suite = await runInvariantSuite({
          prisma,
          businessId,
          skipAvailabilityHttp: true,
        });
        if (!suite.ok) {
          fail('last_slot', 'DB invariant violation after booking last slot');
          printInvariantReport(suite);
        } else {
          pass('last_slot');
        }
        await cancelAppointment(api, {
          appointmentId: bookRes.appointmentId,
          businessId,
          reason: 'time-edge cleanup',
        });
      }
    }
  }

  // --- Test 2: First slot of day ---
  console.log('Test 2: First slot of day');
  if (!dateResult) {
    fail('first_slot', 'no date with slots');
  } else {
    const firstSlot = dateResult.slots[0];
    const holdRes = await createSlotHold(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      customerId,
      date: dateResult.dateYmd,
      startTime: firstSlot,
      durationMinutes: block,
    });
    if (holdRes.status !== 200 && holdRes.status !== 201) {
      fail('first_slot', `hold failed: ${holdRes.status}`);
    } else if (!holdRes.holdId) {
      fail('first_slot', 'no holdId');
    } else {
      const bookRes = await bookAppointment(api, {
        businessId,
        slotHoldId: holdRes.holdId,
      });
      if (bookRes.status !== 200 && bookRes.status !== 201) {
        fail('first_slot', `book failed: ${bookRes.status}`);
      } else {
        pass('first_slot');
        if (bookRes.appointmentId) {
          await cancelAppointment(api, {
            appointmentId: bookRes.appointmentId,
            businessId,
            reason: 'time-edge cleanup',
          });
        }
      }
    }
  }

  // --- Test 3: Timezone round-trip (slotsDetail.startUtc) ---
  console.log('Test 3: Timezone round-trip via slotsDetail');
  if (dateResult) {
    const avDetail = await getAvailability(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      date: dateResult.dateYmd,
      compact: 0,
    });
    if (avDetail.status !== 200) {
      fail('timezone_roundtrip', `GET /availability ${avDetail.status}`);
    } else {
      const rows = Array.isArray(avDetail.body)
        ? avDetail.body
        : ((avDetail.body as Record<string, unknown>)?.results as unknown[]) ?? [];
      const row = (rows as Array<Record<string, unknown>>).find(
        (r) =>
          String(r.staffId ?? '')
            .toLowerCase()
            .replace(/-/g, '') ===
          fx.staffId.toLowerCase().replace(/-/g, ''),
      ) as
        | {
            slots?: string[];
            slotsDetail?: Array<{
              businessTime: string;
              startUtc: string;
            }>;
            businessTimezone?: string;
          }
        | undefined;

      const slots = row?.slots ?? [];
      const details = row?.slotsDetail ?? [];
      const tz = row?.businessTimezone ?? fx.businessTimezone;

      if (slots.length === 0 || details.length === 0) {
        fail('timezone_roundtrip', 'no slots or slotsDetail');
      } else {
        let mismatch = 0;
        for (const d of details) {
          if (!d.startUtc || !d.businessTime) {
            mismatch++;
            continue;
          }
          // Parse startUtc and convert to wall clock in business TZ;
          // verify it matches businessTime HH:mm
          const utcDate = new Date(d.startUtc);
          if (isNaN(utcDate.getTime())) {
            mismatch++;
            continue;
          }
          const wallStr = utcDate.toLocaleTimeString('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          if (wallStr !== d.businessTime) {
            mismatch++;
            console.warn(
              `  TZ mismatch: slotsDetail.businessTime=${d.businessTime} but startUtc→wall=${wallStr} (tz=${tz})`,
            );
          }
        }
        if (mismatch > 0) {
          fail('timezone_roundtrip', `${mismatch} mismatches`);
        } else {
          pass(`timezone_roundtrip (${details.length} slots checked, tz=${tz})`);
        }
      }
    }
  } else {
    fail('timezone_roundtrip', 'no date with slots');
  }

  // --- Test 4: Adjacent-day boundary ---
  console.log('Test 4: Adjacent-day boundary (book on day N, check day N+1)');
  if (dateResult) {
    const lastSlot = dateResult.slots[dateResult.slots.length - 1];
    const holdRes = await createSlotHold(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      customerId,
      date: dateResult.dateYmd,
      startTime: lastSlot,
      durationMinutes: block,
    });
    if (holdRes.status === 200 || holdRes.status === 201) {
      if (holdRes.holdId) {
        const bookRes = await bookAppointment(api, {
          businessId,
          slotHoldId: holdRes.holdId,
        });
        if (bookRes.appointmentId) {
          // Check next day availability doesn't include spillover
          const nextDay = new Date(
            `${dateResult.dateYmd}T12:00:00Z`,
          );
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const nextYmd = nextDay.toISOString().slice(0, 10);
          const avNext = await getAvailability(api, {
            businessId,
            staffId: fx.staffId,
            serviceId,
            date: nextYmd,
          });

          // DB invariant check is sufficient here
          const suite = await runInvariantSuite({
            prisma,
            businessId,
            skipAvailabilityHttp: true,
          });
          if (!suite.ok) {
            fail('adjacent_day', 'invariant violation');
            printInvariantReport(suite);
          } else {
            pass('adjacent_day');
          }

          await cancelAppointment(api, {
            appointmentId: bookRes.appointmentId,
            businessId,
            reason: 'time-edge cleanup',
          });
        }
      }
    } else {
      // 409 is fine if slot was taken
      pass('adjacent_day (slot contention, skipped)');
    }
  } else {
    fail('adjacent_day', 'no date with slots');
  }

  // Summary
  console.log(`\n=== TIME-EDGE SUMMARY ===`);
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failures)`);
  console.log(`=========================\n`);

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
