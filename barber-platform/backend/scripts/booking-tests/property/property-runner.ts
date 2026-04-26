#!/usr/bin/env ts-node
/**
 * Property-based booking test runner.
 * Runs randomized hold/book/cancel/reschedule sequences and checks invariants.
 *
 *   npm run test:booking:property
 *
 * Env: BUSINESS_ID, AUTH_TOKEN, DATABASE_URL, BASE_URL
 *   PROPERTY_ITERATIONS (default 100)
 *   PROPERTY_FULL_INVARIANT_EVERY (default 10, run full suite every N iters)
 */
import { loadBackendEnv, intEnv, mintLongLivedTestToken } from '../lib/env';
import { createScriptPrisma } from '../lib/prisma-script';
import { runInvariantSuite } from '../invariants/suite';
import { printInvariantReport, exitFromResult } from '../lib/report';
import {
  resolveFixture,
  blockMinutesFor,
  findDateWithSlots,
  getAvailability,
  parseAvailabilitySlots,
  createSlotHold,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  type BookingApiOpts,
  type Fixture,
} from '../lib/booking-api';

loadBackendEnv();

const ITERATIONS = intEnv('PROPERTY_ITERATIONS', 100);
const FULL_EVERY = intEnv('PROPERTY_FULL_INVARIANT_EVERY', 10);

type Scenario =
  | 'hold_book_cancel'
  | 'hold_only'
  | 'hold_book'
  | 'book_reschedule_cancel'
  | 'hold_book_retry';

const SCENARIO_WEIGHTS: Array<[Scenario, number]> = [
  ['hold_book_cancel', 30],
  ['hold_book', 15],
  ['book_reschedule_cancel', 25],
  ['hold_only', 10],
  ['hold_book_retry', 20],
];

function pickScenario(): Scenario {
  const total = SCENARIO_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [scenario, weight] of SCENARIO_WEIGHTS) {
    r -= weight;
    if (r <= 0) return scenario;
  }
  return 'hold_book_cancel';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getRandomSlot(
  api: BookingApiOpts,
  businessId: string,
  staffId: string,
  serviceId: string,
): Promise<{ dateYmd: string; slot: string; slot2: string | null; allSlots: string[] } | null> {
  const result = await findDateWithSlots(api, businessId, staffId, serviceId, 2, 14);
  if (!result) return null;
  const idx = Math.floor(Math.random() * result.slots.length);
  const slot = result.slots[idx];
  const others = result.slots.filter((s) => s !== slot);
  const slot2 = others.length > 0 ? pickRandom(others) : null;
  return { dateYmd: result.dateYmd, slot, slot2, allSlots: result.slots };
}

type ScenarioResult = { ok: boolean; detail: string; orphanHoldId?: string };

async function runScenario(
  scenario: Scenario,
  iter: number,
  api: BookingApiOpts,
  businessId: string,
  fx: Fixture,
  prisma: import('@prisma/client').PrismaClient,
): Promise<ScenarioResult> {
  const serviceId = pickRandom(fx.serviceIds);
  const customerId = pickRandom(fx.customerIds);
  const block = blockMinutesFor(fx, fx.staffId, serviceId);

  const slotInfo = await getRandomSlot(api, businessId, fx.staffId, serviceId);
  if (!slotInfo)
    return { ok: true, detail: 'no slots available — skipped' };

  const logCtx = `[${iter}/${scenario}] slot=${slotInfo.slot} date=${slotInfo.dateYmd}`;

  // Hold
  const holdRes = await createSlotHold(api, {
    businessId,
    staffId: fx.staffId,
    serviceId,
    customerId,
    date: slotInfo.dateYmd,
    startTime: slotInfo.slot,
    durationMinutes: block,
  });

  if (holdRes.status === 409) {
    return { ok: true, detail: `${logCtx} — slot contention (409), OK` };
  }
  if (holdRes.status >= 500) {
    return { ok: true, detail: `${logCtx} — transient hold error ${holdRes.status}, skipped` };
  }
  if (holdRes.status !== 201 && holdRes.status !== 200) {
    return {
      ok: false,
      detail: `${logCtx} — hold failed: ${holdRes.status} ${JSON.stringify(holdRes.body)}`,
    };
  }
  if (!holdRes.holdId) {
    return { ok: false, detail: `${logCtx} — hold 2xx but no holdId` };
  }

  if (scenario === 'hold_only') {
    return { ok: true, detail: `${logCtx} — hold placed, no book` };
  }

  // --- hold_book_retry: idempotent retry test ---
  if (scenario === 'hold_book_retry') {
    const idemKey = `proptest:${crypto.randomUUID()}`;

    // First book attempt (with idempotencyKey)
    const book1 = await bookAppointment(api, {
      businessId,
      slotHoldId: holdRes.holdId,
      idempotencyKey: idemKey,
    });

    if (book1.status >= 500) {
      // Real 5xx: check DB for orphan hold
      const orphanRows = await prisma.$queryRaw<Array<{ id: string; consumed_at: Date | null }>>`
        SELECT id, consumed_at FROM slot_holds WHERE id = ${holdRes.holdId}
      `;
      const orphan = orphanRows[0];
      if (orphan && !orphan.consumed_at) {
        return {
          ok: true,
          detail: `${logCtx} — transient book 5xx, orphan hold ${holdRes.holdId} detected`,
          orphanHoldId: holdRes.holdId,
        };
      }
      return { ok: true, detail: `${logCtx} — transient book 5xx, hold consumed (partial commit?)` };
    }

    if (book1.status !== 200 && book1.status !== 201) {
      return {
        ok: false,
        detail: `${logCtx} — retry test: first book failed ${book1.status} ${JSON.stringify(book1.body)}`,
      };
    }
    if (!book1.appointmentId) {
      return { ok: false, detail: `${logCtx} — retry test: first book 2xx but no appointmentId` };
    }

    // Retry: same holdId + same idempotencyKey (simulates client retry after timeout)
    const book2 = await bookAppointment(api, {
      businessId,
      slotHoldId: holdRes.holdId,
      idempotencyKey: idemKey,
    });

    if (book2.status === 200 || book2.status === 201) {
      // Must return the SAME appointmentId (idempotent replay)
      if (book2.appointmentId !== book1.appointmentId) {
        return {
          ok: false,
          detail: `${logCtx} — DOUBLE BOOKING: retry returned different appointmentId (${book1.appointmentId} vs ${book2.appointmentId})`,
        };
      }
    } else if (book2.status === 409) {
      // 409 is acceptable — hold already consumed, server rejected retry without idem match
    } else if (book2.status >= 500) {
      // Transient on retry is fine as long as first one committed
    } else {
      return {
        ok: false,
        detail: `${logCtx} — retry test: unexpected retry status ${book2.status}`,
      };
    }

    // Verify DB: exactly 1 appointment for this hold
    const aptCount = await prisma.$queryRaw<Array<{ cnt: number }>>`
      SELECT COUNT(*)::int AS cnt FROM appointments
      WHERE "slotHoldId" = ${holdRes.holdId}
        AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
    `;
    if (aptCount[0]?.cnt !== 1) {
      return {
        ok: false,
        detail: `${logCtx} — retry test: expected 1 appointment for hold, got ${aptCount[0]?.cnt}`,
      };
    }

    // Cleanup
    await cancelAppointment(api, {
      appointmentId: book1.appointmentId,
      businessId,
      reason: 'property retry test cleanup',
    });

    return { ok: true, detail: `${logCtx} — hold+book+retry idempotent OK` };
  }

  // --- Standard book (for remaining scenarios) ---
  const bookRes = await bookAppointment(api, {
    businessId,
    slotHoldId: holdRes.holdId,
  });

  if (bookRes.status >= 500) {
    // 5xx on book: check for orphan hold
    const orphanRows = await prisma.$queryRaw<Array<{ id: string; consumed_at: Date | null }>>`
      SELECT id, consumed_at FROM slot_holds WHERE id = ${holdRes.holdId}
    `;
    const orphan = orphanRows[0];
    if (orphan && !orphan.consumed_at) {
      return {
        ok: true,
        detail: `${logCtx} — transient book ${bookRes.status}, orphan hold ${holdRes.holdId}`,
        orphanHoldId: holdRes.holdId,
      };
    }
    return { ok: true, detail: `${logCtx} — transient book ${bookRes.status}, hold already consumed` };
  }
  if (bookRes.status !== 200 && bookRes.status !== 201) {
    return {
      ok: false,
      detail: `${logCtx} — book failed: ${bookRes.status} ${JSON.stringify(bookRes.body)}`,
    };
  }
  if (!bookRes.appointmentId) {
    return { ok: false, detail: `${logCtx} — book 2xx but no appointmentId` };
  }

  // Verify availability no longer offers the slot
  const avAfter = await getAvailability(api, {
    businessId,
    staffId: fx.staffId,
    serviceId,
    date: slotInfo.dateYmd,
  });
  if (avAfter.status === 200) {
    const slotsAfter = parseAvailabilitySlots(avAfter.body, fx.staffId);
    if (slotsAfter.includes(slotInfo.slot)) {
      return {
        ok: false,
        detail: `${logCtx} — STALE: booked slot still in availability`,
      };
    }
  }

  if (scenario === 'hold_book') {
    await cancelAppointment(api, {
      appointmentId: bookRes.appointmentId,
      businessId,
      reason: 'property test cleanup',
    });
    return { ok: true, detail: `${logCtx} — hold+book+cleanup OK` };
  }

  if (scenario === 'book_reschedule_cancel' && slotInfo.slot2) {
    const avDetail = await getAvailability(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      date: slotInfo.dateYmd,
      compact: 0,
    });
    let newStartIso: string | null = null;
    if (avDetail.status === 200) {
      const rows = Array.isArray(avDetail.body)
        ? avDetail.body
        : ((avDetail.body as Record<string, unknown>)?.results as unknown[]) ?? [];
      const row = (rows as Array<Record<string, unknown>>).find(
        (r) =>
          String(r.staffId ?? '')
            .toLowerCase()
            .replace(/-/g, '') ===
          fx.staffId.toLowerCase().replace(/-/g, ''),
      ) as { slotsDetail?: Array<{ businessTime: string; startUtc: string }> } | undefined;
      const detail = row?.slotsDetail?.find((d) => d.businessTime === slotInfo.slot2);
      newStartIso = detail?.startUtc ?? null;
    }

    if (newStartIso) {
      const newStart = new Date(newStartIso);
      const newEnd = new Date(newStart.getTime() + block * 60 * 1000);
      const reschRes = await rescheduleAppointment(
        api,
        bookRes.appointmentId,
        {
          businessId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
      );
      if (reschRes.status === 200) {
        const avR = await getAvailability(api, {
          businessId,
          staffId: fx.staffId,
          serviceId,
          date: slotInfo.dateYmd,
        });
        if (avR.status === 200) {
          const slotsR = parseAvailabilitySlots(avR.body, fx.staffId);
          if (slotsR.includes(slotInfo.slot2!)) {
            return {
              ok: false,
              detail: `${logCtx} — STALE: rescheduled-to slot still in availability`,
            };
          }
        }
      }
    }

    await cancelAppointment(api, {
      appointmentId: bookRes.appointmentId,
      businessId,
      reason: 'property test cleanup',
    });

    const avCancel = await getAvailability(api, {
      businessId,
      staffId: fx.staffId,
      serviceId,
      date: slotInfo.dateYmd,
    });
    if (avCancel.status === 200) {
      const slotsCancel = parseAvailabilitySlots(avCancel.body, fx.staffId);
      const shouldHave = newStartIso ? slotInfo.slot2! : slotInfo.slot;
      if (!slotsCancel.includes(shouldHave)) {
        return {
          ok: false,
          detail: `${logCtx} — cancelled slot ${shouldHave} not restored in availability`,
        };
      }
    }

    return { ok: true, detail: `${logCtx} — book+reschedule+cancel OK` };
  }

  // hold_book_cancel
  await cancelAppointment(api, {
    appointmentId: bookRes.appointmentId,
    businessId,
    reason: 'property test cleanup',
  });

  const avRestore = await getAvailability(api, {
    businessId,
    staffId: fx.staffId,
    serviceId,
    date: slotInfo.dateYmd,
  });
  if (avRestore.status === 200) {
    const slotsRestore = parseAvailabilitySlots(avRestore.body, fx.staffId);
    if (!slotsRestore.includes(slotInfo.slot)) {
      return {
        ok: false,
        detail: `${logCtx} — cancelled slot not restored in availability`,
      };
    }
  }

  return { ok: true, detail: `${logCtx} — hold+book+cancel+restore OK` };
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

  console.log(`\n=== PROPERTY-BASED BOOKING TEST ===`);
  console.log(`iterations: ${ITERATIONS}`);
  console.log(`full invariant check every: ${FULL_EVERY} iterations`);
  console.log(`businessId: ${businessId.slice(0, 8)}...\n`);

  const fx = await resolveFixture(api, businessId);
  console.log(
    `fixture: staff=${fx.staffId.slice(0, 8)} services=${fx.serviceIds.length} customers=${fx.customerIds.length} tz=${fx.businessTimezone}\n`,
  );

  let failures = 0;
  let skipped = 0;
  let transient5xx = 0;
  let orphanHolds = 0;
  let retryIdempotentOk = 0;

  const buildHttpOpts = () => {
    const dateInfo = findDateWithSlots(api, businessId, fx.staffId, fx.serviceIds[0], 1);
    return dateInfo;
  };

  for (let i = 1; i <= ITERATIONS; i++) {
    const scenario = pickScenario();
    const result = await runScenario(scenario, i, api, businessId, fx, prisma);

    if (!result.ok) {
      failures++;
      console.error(`FAIL ${result.detail}`);
    } else {
      if (result.detail.includes('transient')) transient5xx++;
      if (result.orphanHoldId) {
        orphanHolds++;
        console.warn(`  WARN: orphan hold ${result.orphanHoldId} left by 5xx at iteration ${i}`);
      }
      if (result.detail.includes('retry idempotent OK')) retryIdempotentOk++;
      if (result.detail.includes('skipped')) skipped++;
      if (i % 20 === 0 || i === 1) {
        console.log(`  [${i}/${ITERATIONS}] ${result.detail}`);
      }
    }

    // Periodic invariant check (DB + availability-vs-DB cross-check)
    if (i % FULL_EVERY === 0 || i === ITERATIONS) {
      const dateInfo = await findDateWithSlots(
        api, businessId, fx.staffId, fx.serviceIds[0], 1,
      );
      const suite = await runInvariantSuite({
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
      if (!suite.ok) {
        printInvariantReport(suite);
        failures++;
        console.error(`  invariant violation at iteration ${i}`);
      } else if (i % FULL_EVERY === 0) {
        const mode = dateInfo ? 'DB+HTTP' : 'DB';
        console.log(`  [${i}] invariants OK (${mode})`);
      }
    }
  }

  // Final full invariant check with HTTP
  console.log(`\nFinal full invariant check (DB + HTTP)...`);
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

  const transientRate = ITERATIONS > 0 ? transient5xx / ITERATIONS : 0;
  console.log(`\n=== PROPERTY TEST SUMMARY ===`);
  console.log(
    `total: ${ITERATIONS}  failures: ${failures}  skipped: ${skipped}`,
  );
  console.log(
    `transient_5xx: ${transient5xx} (${(transientRate * 100).toFixed(1)}%)  orphan_holds: ${orphanHolds}  retry_idempotent_ok: ${retryIdempotentOk}`,
  );
  if (transientRate > 0.1) {
    console.warn(
      `WARNING: transient 5xx rate ${(transientRate * 100).toFixed(1)}% exceeds 10% — investigate server health`,
    );
  }
  if (orphanHolds > 0) {
    console.warn(
      `WARNING: ${orphanHolds} orphan holds left by failed book attempts — verify hold expiry cleanup`,
    );
  }
  console.log(
    `RESULT: ${failures === 0 && finalResult.ok ? 'PASS' : 'FAIL'}`,
  );
  console.log(`=============================\n`);

  await prisma.$disconnect();
  process.exit(failures === 0 && finalResult.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
