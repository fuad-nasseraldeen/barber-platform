/**
 * k6 — Booking concurrency: many VUs fight for the same wall-clock slot (real DB races).
 *
 * API (this repo):
 *   GET  /api/v1/availability
 *   POST /api/v1/appointments/slot-holds
 *   POST /api/v1/appointments/book   (also /book)
 *
 * Env (required):
 *   BUSINESS_ID, AUTH_TOKEN (or K6_AUTH_TOKEN)
 * Env (optional):
 *   BASE_URL, API_PREFIX
 *   K6_RACE_VUS — default 8 (recommended 5–10). One synchronized wave: all VUs run once (per-vu-iterations, iterations: 1).
 *   K6_RACE_DATE — optional YYYY-MM-DD pinned day (only this script; do not use K6_CORRECTNESS_DATE here — it is for k6:correctness and often matches prisma seed anchor / past days).
 *   K6_RACE_SLOT_INDEX — default 3 (stable; avoid always-picking first slot)
 *   K6_SERVICE_DURATIONS=uuid:minutes — duration for POST hold (must match service block)
 *   K6_RACE_SLEEP_MAX_MS — default 500 (random sleep before hold)
 *   K6_RACE_SKIP_PER_VU_GET=1 — “stale client”: no GET per VU; everyone uses slot from setup() snapshot only
 *   K6_RACE_VERBOSE=1 — per-VU console logs
 *   STAFF_IDS, SERVICE_IDS, CUSTOMER_IDS — optional; need ≥ K6_RACE_VUS distinct customers when using CUSTOMER_IDS
 *
 * Throttling: set DISABLE_BOOKING_THROTTLE=1 on API for fair races with one JWT.
 *
 * Redis / cache (server-side): GET /health/diagnostics — console.log('REDIS RESPONSE:', body) + summary JSON.
 *   API: ENABLE_HEALTH_DIAGNOSTICS=1 (localhost / load lab only).
 *   k6: K6_PRINT_REDIS_DIAG=0 to skip.
 * Setup GET /availability: console.log('RAW RESPONSE:', body) once after 200.
 * Availability timing header: API AVAILABILITY_TIMING_RESPONSE_HEADER=1 → k6 K6_PRINT_AVAILABILITY_TIMING=1 logs JSON from X-Availability-Timing per GET.
 * Parity with server LOG_AVAILABILITY_QUERY_DEBUG: set same in backend/.env when running k6 (forwarded to __ENV).
 *
 * Run:
 *   k6 run k6/booking-race-concurrency.test.js
 */

import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

const DEFAULT_MAX_SLOTS_PER_ROW = 192;

const RACE_VUS = Math.min(50, Math.max(2, parseInt(__ENV.K6_RACE_VUS || '8', 10) || 8));
const RACE_SLOT_INDEX = Math.max(0, parseInt(__ENV.K6_RACE_SLOT_INDEX || '3', 10) || 3);
const RACE_SLEEP_MAX_MS = Math.max(0, parseInt(__ENV.K6_RACE_SLEEP_MAX_MS || '500', 10) || 500);
const SKIP_PER_VU_GET = __ENV.K6_RACE_SKIP_PER_VU_GET === '1';
const LATENCY_P95 = parseInt(__ENV.K6_LATENCY_P95_MS || '3000', 10) || 3000;
const VERBOSE = __ENV.K6_RACE_VERBOSE === '1';
const PRINT_REDIS_DIAG = __ENV.K6_PRINT_REDIS_DIAG !== '0';

const BOOK_DURATION_FALLBACK = Number(__ENV.BOOK_DURATION_MINUTES || '45');

/** Custom metrics (aggregated globally). */
const race_hold_201 = new Counter('race_hold_201');
const race_hold_409 = new Counter('race_hold_409');
const race_hold_other = new Counter('race_hold_other');
const race_book_201 = new Counter('race_book_201');
const race_slot_still_offered_after_book = new Counter('race_bug_slot_still_offered');

const trend_hold_ms = new Trend('race_hold_duration_ms', true);
const trend_get_avail_ms = new Trend('race_get_availability_ms', true);

export const options = {
  scenarios: {
    booking_slot_race: {
      executor: 'per-vu-iterations',
      vus: RACE_VUS,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    race_hold_201: ['count == 1'],
    race_hold_409: [`count == ${RACE_VUS - 1}`],
    race_hold_other: ['count == 0'],
    race_book_201: ['count == 1'],
    race_bug_slot_still_offered: ['count == 0'],
    'http_req_duration{expected_response:true}': [`p(95)<${LATENCY_P95}`],
  },
};

function stripBearer(v) {
  return String(v || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function toQueryString(obj) {
  const parts = [];
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

function safeJson(res) {
  try {
    return res.body ? JSON.parse(res.body) : null;
  } catch (_) {
    return null;
  }
}

function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Server reports Redis ping + CacheService SET/GET/DEL probe (no secrets).
 * Requires API ENABLE_HEALTH_DIAGNOSTICS=1.
 */
function printBackendRedisDiagnostics() {
  if (!PRINT_REDIS_DIAG) return;
  const url = `${API_BASE}/health/diagnostics`;
  const r = http.get(url, { tags: { endpoint: 'k6_redis_diag' } });
  console.log('REDIS RESPONSE:', r.body);
  if (r.status === 200) {
    const j = safeJson(r);
    const redis = j && j.redis ? j.redis : null;
    const cache = j && j.cache ? j.cache : null;
    console.log(
      JSON.stringify({
        tag: 'k6_redis_backend',
        redisMode: redis ? redis.mode : null,
        redisPing: redis ? redis.ping : null,
        redisPingMs: redis ? redis.pingMs : null,
        redisError: redis ? redis.error : null,
        cacheRoundTripOk: cache ? cache.ok : null,
        cacheRoundTripMs: cache ? cache.roundTripMs : null,
        cacheDetail: cache ? cache.detail : null,
      }),
    );
    return;
  }
  if (r.status === 404) {
    console.log(
      JSON.stringify({
        tag: 'k6_redis_backend',
        skipped: 'GET /health/diagnostics → 404. Set ENABLE_HEALTH_DIAGNOSTICS=1 on the API to see Redis + cache probe.',
      }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      tag: 'k6_redis_backend',
      httpStatus: r.status,
      bodySlice: String(r.body || '').slice(0, 240),
    }),
  );
}

function idNorm(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/-/g, '');
}

function hhmmToMinutes(hhmm) {
  const parts = String(hhmm).trim().split(':').map((p) => parseInt(p, 10));
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  return h * 60 + m;
}

function sortSlotsChrono(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
}

function parseServiceDurationMap() {
  const raw = String(__ENV.K6_SERVICE_DURATIONS || '').trim();
  const map = Object.create(null);
  if (!raw) return map;
  for (const piece of raw.split(',')) {
    const idx = piece.indexOf(':');
    if (idx <= 0) continue;
    const id = piece.slice(0, idx).trim();
    const n = Number(piece.slice(idx + 1).trim());
    if (id && Number.isFinite(n) && n > 0) map[idNorm(id)] = Math.floor(n);
  }
  return map;
}

const SERVICE_DURATION_MAP = parseServiceDurationMap();

function bookingDurationForService(serviceId) {
  if (!serviceId) return BOOK_DURATION_FALLBACK;
  const d = SERVICE_DURATION_MAP[idNorm(serviceId)];
  return Number.isFinite(d) && d > 0 ? d : BOOK_DURATION_FALLBACK;
}

/**
 * Same as booking-correctness: staff+service block = staff override duration OR service duration + buffers.
 * POST slot-holds must send this value or API returns 400 ("durationMinutes must be N … (includes buffers)").
 */
function fetchAvailabilityBlockByStaffService(token, businessId) {
  const headers = authHeaders(token);
  const r = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, {
    headers,
    tags: { endpoint: 'setup_services_block' },
  });
  const out = Object.create(null);
  if (r.status !== 200) return out;
  const list = safeJson(r);
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || !s.id) continue;
    const svcId = s.id;
    const baseDur = Number(s.durationMinutes) || 0;
    const bufB = Number(s.bufferBeforeMinutes) || 0;
    const bufA = Number(s.bufferAfterMinutes) || 0;
    const staffSvcs = Array.isArray(s.staffServices) ? s.staffServices : [];
    for (let j = 0; j < staffSvcs.length; j++) {
      const ss = staffSvcs[j];
      if (!ss || !ss.staffId) continue;
      const ssDur = Number(ss.durationMinutes) || 0;
      const serviceMinutes = (ssDur > 0 ? ssDur : baseDur) || 30;
      const block = serviceMinutes + bufB + bufA;
      const key = `${idNorm(ss.staffId)}|${idNorm(svcId)}`;
      out[key] = Math.max(1, Math.floor(block));
    }
  }
  return out;
}

function durationMinutesForHold(blockMap, staffId, serviceId) {
  if (blockMap && staffId && serviceId) {
    const k = `${idNorm(staffId)}|${idNorm(serviceId)}`;
    const v = blockMap[k];
    if (Number.isFinite(v) && v > 0) return Math.max(1, Math.floor(v));
  }
  return bookingDurationForService(serviceId);
}

function mergeTags(endpoint, tags) {
  const t = tags || {};
  return Object.assign({ endpoint: endpoint }, t);
}

/** Mirrors Express `req.query`: flat string values from the serialized query string. */
function rawQueryFromQs(qs) {
  const raw = Object.create(null);
  if (!qs || String(qs).length === 0) return raw;
  const parts = String(qs).split('&');
  for (let p = 0; p < parts.length; p++) {
    const piece = parts[p];
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const k = decodeURIComponent(piece.slice(0, eq).replace(/\+/g, ' '));
    const v = decodeURIComponent(piece.slice(eq + 1).replace(/\+/g, ' '));
    raw[k] = v;
  }
  return raw;
}

function logAvailabilityQueryDebug(merged, qs) {
  if (__ENV.LOG_AVAILABILITY_QUERY_DEBUG !== '1') return;
  console.log('RAW QUERY:', rawQueryFromQs(qs));
  /* Server DTO turns "1"/"true" → boolean; here we log the payload object k6 merged before serialize. */
  console.log('COMPACT AFTER TRANSFORM:', merged.compact);
}

function logAvailabilityTimingHeader(res) {
  if (__ENV.K6_PRINT_AVAILABILITY_TIMING !== '1') return;
  if (!res || res.status !== 200) return;
  const h =
    res.headers['X-Availability-Timing'] ||
    res.headers['x-availability-timing'];
  if (!h) return;
  try {
    console.log('k6_AVAILABILITY_TIMING', JSON.stringify(JSON.parse(h)));
  } catch (_) {
    console.log('k6_AVAILABILITY_TIMING_RAW', String(h).slice(0, 800));
  }
}

function getAvailability(params, headers, tags) {
  const merged = Object.assign({}, params, {
    days: params.days !== undefined && params.days !== null ? params.days : 1,
    maxSlotsPerRow:
      params.maxSlotsPerRow !== undefined && params.maxSlotsPerRow !== null
        ? params.maxSlotsPerRow
        : DEFAULT_MAX_SLOTS_PER_ROW,
    chronologicalSlots: params.chronologicalSlots !== false,
  });
  const qs = toQueryString(merged);
  logAvailabilityQueryDebug(merged, qs);
  const res = http.get(`${API_BASE}/availability?${qs}`, {
    headers,
    tags: mergeTags('availability', tags),
  });
  logAvailabilityTimingHeader(res);
  return res;
}

function createSlotHold(payload, headers, tags) {
  return http.post(`${API_BASE}/appointments/slot-holds`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('slot_holds', tags),
  });
}

function createBooking(payload, headers, tags) {
  return http.post(`${API_BASE}/appointments/book`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('book', tags),
  });
}

function cancelAppointment(payload, headers, tags) {
  return http.post(`${API_BASE}/appointments/cancel`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('cancel', tags),
  });
}

function rowForStaff(rowsPayload, staffId) {
  let rows = rowsPayload;
  if (!Array.isArray(rows) && rows && Array.isArray(rows.results)) rows = rows.results;
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r && idNorm(r.staffId) === idNorm(staffId)) || null;
}

function parseFixtureFromEnv() {
  const staff = (__ENV.STAFF_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const services = (__ENV.SERVICE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const customers = (__ENV.CUSTOMER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (staff.length && services.length && customers.length) {
    return {
      staffId: staff[0],
      serviceId: services[0],
      customerIds: customers,
    };
  }
  return null;
}

function authHint401(resource) {
  return (
    `${resource} 401 Unauthorized — refresh AUTH_TOKEN (or K6_AUTH_TOKEN) in backend/.env; ` +
    `ensure BASE_URL matches the API that issued the JWT (${API_BASE}).`
  );
}

function httpResolveCustomers(businessId, token, minCount) {
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };
  /** ListCustomersQueryDto only allows businessId / branchId / search — extra keys → 400 (whitelist). */
  const r = http.get(`${API_BASE}/customers?${toQueryString({ businessId })}`, {
    headers,
    tags: { endpoint: 'setup_customers' },
  });
  if (r.status === 401) throw new Error(authHint401('GET /customers'));
  if (r.status !== 200) {
    throw new Error(`GET /customers ${r.status} ${String(r.body || '').slice(0, 200)}`);
  }
  const list = safeJson(r);
  if (!Array.isArray(list) || list.length < minCount) {
    throw new Error(`Need at least ${minCount} customers; got ${Array.isArray(list) ? list.length : 0}`);
  }
  return list.map((c) => c.id).filter(Boolean);
}

function httpResolveStaffService(businessId, token) {
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };
  const staffR = http.get(`${API_BASE}/staff?${toQueryString({ businessId, limit: 100, page: 1 })}`, {
    headers,
    tags: { endpoint: 'setup_staff' },
  });
  if (staffR.status === 401) throw new Error(authHint401('GET /staff'));
  if (staffR.status !== 200) {
    throw new Error(`GET /staff ${staffR.status} ${String(staffR.body || '').slice(0, 200)}`);
  }
  const staffList = safeJson(staffR);
  if (!Array.isArray(staffList) || !staffList.length) throw new Error('empty staff');
  const staffId = staffList[0].id;

  const svcR = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, {
    headers,
    tags: { endpoint: 'setup_services' },
  });
  if (svcR.status === 401) throw new Error(authHint401('GET /services'));
  if (svcR.status !== 200) {
    throw new Error(`GET /services ${svcR.status} ${String(svcR.body || '').slice(0, 200)}`);
  }
  const serviceList = safeJson(svcR);
  if (!Array.isArray(serviceList) || !serviceList.length) throw new Error('empty services');
  const offered = serviceList.filter((s) =>
    (s.staffServices || []).some(
      (ss) =>
        ss &&
        ss.staffId &&
        idNorm(ss.staffId) === idNorm(staffId) &&
        ss.allowBooking !== false,
    ),
  );
  const preferred =
    offered.find((s) => Number(s.durationMinutes) === 25) || offered[0];
  if (!preferred) throw new Error('no service for staff');
  return { staffId, serviceId: preferred.id };
}

export function setup() {
  printBackendRedisDiagnostics();

  const businessId = (__ENV.BUSINESS_ID || __ENV.TEST_BUSINESS_ID || '').trim();
  const token = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
  if (!businessId) throw new Error('BUSINESS_ID required');
  if (!token) throw new Error('AUTH_TOKEN required');

  const needCustomers = RACE_VUS;

  let staffId;
  let serviceId;
  let customerIds;

  const envFx = parseFixtureFromEnv();
  if (envFx) {
    staffId = envFx.staffId;
    serviceId = envFx.serviceId;
    customerIds = envFx.customerIds;
    if (customerIds.length < needCustomers) {
      throw new Error(`CUSTOMER_IDS: need at least ${needCustomers} UUIDs for ${RACE_VUS} VUs`);
    }
  } else {
    const ss = httpResolveStaffService(businessId, token);
    staffId = ss.staffId;
    serviceId = ss.serviceId;
    customerIds = httpResolveCustomers(businessId, token, needCustomers);
  }

  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };
  const minSlots = RACE_SLOT_INDEX + 1;

  const explicitDate = (__ENV.K6_RACE_DATE || '').trim().slice(0, 10);
  let testDate = /^\d{4}-\d{2}-\d{2}$/.test(explicitDate) ? explicitDate : null;

  const tryYmd = (ymd) => {
    const av = getAvailability(
      {
        businessId,
        date: ymd,
        staffId,
        serviceId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
      { phase: 'setup_resolve' },
    );
    if (av.status !== 200) return null;
    const row = rowForStaff(safeJson(av), staffId);
    const slots = sortSlotsChrono(row && Array.isArray(row.slots) ? row.slots : []);
    return slots.length >= minSlots ? { ymd, slots } : null;
  };

  if (!testDate) {
    for (let off = 0; off <= 28 && !testDate; off++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + off);
      const ymd = d.toISOString().slice(0, 10);
      const hit = tryYmd(ymd);
      if (hit) testDate = hit.ymd;
      sleep(0.02);
    }
  }

  if (!testDate) {
    const anchor = (__ENV.K6_SEED_ANCHOR_YMD || '2026-04-07').trim().slice(0, 10);
    for (let i = 0; i < 14 && !testDate; i++) {
      const d = new Date(`${anchor}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      const hit = tryYmd(ymd);
      if (hit) testDate = hit.ymd;
      sleep(0.02);
    }
  }

  if (!testDate) {
    throw new Error(
      'setup: no calendar day with enough slots for this staff (need ' +
        minSlots +
        `). USE_TIME_SLOTS: re-run seed-time-slots, or set K6_RACE_DATE to a seeded day.`,
    );
  }

  const avSetup = getAvailability(
    {
      businessId,
      date: testDate,
      staffId,
      serviceId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
    { phase: 'setup' },
  );
  if (avSetup.status !== 200) {
    throw new Error(`setup GET /availability ${avSetup.status} ${String(avSetup.body || '').slice(0, 300)}`);
  }
  console.log('RAW RESPONSE:', avSetup.body);
  const row = rowForStaff(safeJson(avSetup), staffId);
  const slots = sortSlotsChrono(row && Array.isArray(row.slots) ? row.slots : []);
  if (slots.length <= RACE_SLOT_INDEX) {
    throw new Error(
      `setup: not enough slots (have ${slots.length}, need index ${RACE_SLOT_INDEX}). Pick another date or lower K6_RACE_SLOT_INDEX.`,
    );
  }
  const targetSlot = slots[RACE_SLOT_INDEX];
  const blockMap = fetchAvailabilityBlockByStaffService(token, businessId);
  const durationMinutes = durationMinutesForHold(blockMap, staffId, serviceId);

  return {
    businessId,
    token,
    staffId,
    serviceId,
    customerIds,
    testDate,
    targetSlot,
    durationMinutes,
    skipPerVuGet: SKIP_PER_VU_GET,
  };
}

export default function (data) {
  const vu = __VU;
  const iter = __ITER;
  const headers = { ...authHeaders(data.token), 'Content-Type': 'application/json' };
  const customerId = data.customerIds[vu - 1];
  if (!customerId) {
    fail(`No customerId for VU ${vu}`);
    return;
  }

  const targetSlot = data.targetSlot;

  if (!data.skipPerVuGet) {
    const av = getAvailability(
      {
        businessId: data.businessId,
        date: data.testDate,
        staffId: data.staffId,
        serviceId: data.serviceId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
      { vu, iter, phase: 'pre_hold' },
    );
    trend_get_avail_ms.add(av.timings.duration);
    const listed = check(av, {
      'GET availability 200': (r) => r.status === 200,
    });
    if (!listed) {
      race_hold_other.add(1);
      return;
    }
    const row = rowForStaff(safeJson(av), data.staffId);
    const slots = sortSlotsChrono(row && row.slots ? row.slots : []);
    const stillThere = slots.includes(targetSlot);
    if (!stillThere && VERBOSE) {
      console.warn(
        JSON.stringify({
          tag: 'race_pre_hold_slot_missing',
          vu,
          iter,
          targetSlot,
          hint: 'slot already held/booked or filtered — hold may 409 or 400',
        }),
      );
    }
  }

  if (RACE_SLEEP_MAX_MS > 0) {
    sleep((Math.random() * RACE_SLEEP_MAX_MS) / 1000);
  }

  const holdPayload = {
    businessId: data.businessId,
    staffId: data.staffId,
    serviceId: data.serviceId,
    customerId,
    date: data.testDate,
    startTime: targetSlot,
    durationMinutes: data.durationMinutes,
  };

  const holdRes = createSlotHold(holdPayload, headers, { vu, iter });
  trend_hold_ms.add(holdRes.timings.duration);

  const okHold = check(holdRes, {
    'hold status valid': (r) =>
      r.status === 200 || r.status === 201 || r.status === 409,
  });
  if (!okHold) {
    race_hold_other.add(1);
    console.error(
      JSON.stringify({
        tag: 'race_hold_unexpected',
        vu,
        iter,
        status: holdRes.status,
        body: String(holdRes.body || '').slice(0, 500),
      }),
    );
    return;
  }

  if (holdRes.status === 201) {
    race_hold_201.add(1);
    if (VERBOSE) {
      console.log(JSON.stringify({ tag: 'race_hold_won', vu, iter, slot: targetSlot }));
    }

    const body = safeJson(holdRes);
    const holdId = body && body.hold && body.hold.id ? body.hold.id : null;
    if (!holdId) {
      race_hold_other.add(1);
      return;
    }

    const bookRes = createBooking(
      { businessId: data.businessId, slotHoldId: holdId },
      headers,
      { vu, iter, phase: 'book' },
    );
    const bookOk = check(bookRes, {
      'POST book accepted': (r) => r.status === 200 || r.status === 201,
    });
    if (bookOk) race_book_201.add(1);

    const bookJson = safeJson(bookRes);
    const aptId = bookOk && bookJson && bookJson.id ? bookJson.id : null;

    const avAfter = getAvailability(
      {
        businessId: data.businessId,
        date: data.testDate,
        staffId: data.staffId,
        serviceId: data.serviceId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
      { vu, iter, phase: 'post_book' },
    );
    if (avAfter.status === 200) {
      const rowAfter = rowForStaff(safeJson(avAfter), data.staffId);
      const slotsAfter = sortSlotsChrono(rowAfter && rowAfter.slots ? rowAfter.slots : []);
      const stillOffers = slotsAfter.includes(targetSlot);
      check(null, {
        'slot not in availability after book': () => !stillOffers,
      });
      if (stillOffers) race_slot_still_offered_after_book.add(1);
    }

    if (aptId) {
      cancelAppointment(
        { appointmentId: aptId, businessId: data.businessId, reason: 'k6 booking-race cleanup' },
        headers,
        { vu, iter },
      );
    }
  } else {
    race_hold_409.add(1);
    if (VERBOSE) {
      console.log(JSON.stringify({ tag: 'race_hold_conflict', vu, iter, slot: targetSlot }));
    }
  }

}

/** k6/goja: avoid optional chaining / ?? in thresholds summary. */
function metricCounterCount(summaryData, name) {
  const m = summaryData.metrics[name];
  if (!m || !m.values) return 0;
  const c = m.values.count;
  return typeof c === 'number' && !isNaN(c) ? c : 0;
}

export function handleSummary(data) {
  const c201 = metricCounterCount(data, 'race_hold_201');
  const c409 = metricCounterCount(data, 'race_hold_409');
  const cOther = metricCounterCount(data, 'race_hold_other');
  const cBook = metricCounterCount(data, 'race_book_201');
  const cBugSlot = metricCounterCount(data, 'race_bug_slot_still_offered');
  const httpReqs = metricCounterCount(data, 'http_reqs');
  const attempts = RACE_VUS;
  const expect201 = 1;
  const expect409 = RACE_VUS - 1;

  /** Setup threw or VUs never ran — all race counters stay 0 with very few HTTP calls. */
  const setupOrAbort =
    c201 === 0 && c409 === 0 && cOther === 0 && httpReqs > 0 && httpReqs < 15;

  let pass = true;
  const lines = ['\n========== K6 BOOKING RACE — SUMMARY =========='];
  lines.push(`VU count: ${RACE_VUS} (one wave; total hold attempts: ${attempts})`);
  lines.push(`race_hold_201: ${c201} (expect ${expect201})`);
  lines.push(`race_hold_409: ${c409} (expect ${expect409})`);
  lines.push(`race_hold_other: ${cOther} (expect 0)`);
  lines.push(`race_book_201: ${cBook} (expect ${expect201})`);
  lines.push(`race_bug_slot_still_offered: ${cBugSlot}`);

  if (c201 !== expect201) {
    pass = false;
    lines.push(
      `FAIL: multiple or zero hold winners (201). If >1 → DB race bug; if 0 → all lost (throttle/400?)`,
    );
  }
  if (c409 !== expect409) {
    pass = false;
    lines.push(`FAIL: expected ${expect409} conflicts, got ${c409}`);
  }
  if (cOther > 0) {
    pass = false;
    lines.push(`FAIL: unexpected hold status (not 201/409): ${cOther}`);
  }
  if (cBook !== expect201) {
    pass = false;
    lines.push('FAIL: winner did not complete POST /appointments/book');
  }
  if (cBugSlot > 0) {
    pass = false;
    lines.push('FAIL: availability still listed booked slot');
  }

  if (setupOrAbort) {
    pass = false;
    lines.push(
      'NOTE: Race logic did not run — setup() likely threw (see ERRO above). Typical: GET /staff or /customers 401 → renew AUTH_TOKEN / check BASE_URL.',
    );
  }

  lines.push(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  lines.push('================================================\n');
  lines.push(textSummary(data, { indent: ' ', enableColors: false }));

  if (!pass) {
    const stderrMsg = setupOrAbort
      ? 'booking-race: aborted before scenario (check setup / auth)\n'
      : 'booking-race: invariant failed\n';
    return { stdout: lines.join('\n'), stderr: stderrMsg };
  }
  return { stdout: lines.join('\n') };
}
