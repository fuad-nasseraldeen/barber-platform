/**
 * k6 — Booking correctness (single VU). Sole script for `npm run k6:correctness`.
 *
 * Env: BUSINESS_ID, AUTH_TOKEN (+ optional BASE_URL, API_PREFIX).
 * Fixtures: loaded via GET /staff, /services, /customers (needs staff:read, service:read, business:read).
 * Optional override: STAFF_IDS, SERVICE_IDS, CUSTOMER_IDS (comma-separated) if you do not want API discovery.
 *
 * Optional: K6_CORRECTNESS_DATE, K6_SEED_ANCHOR_YMD (default 2026-04-07, match prisma seed),
 *   K6_FALLBACK_DATES=comma-separated YYYY-MM-DD, K6_SLOT_INDEX, K6_SERVICE_DURATIONS=uuid:minutes,...
 *   Step 12 (race / DB vs availability hint): needs 2 distinct customers — second from GET /customers or CUSTOMER_IDS=id1,id2.
 * Debug: K6_AV_RAW_DEBUG=1 — log raw GET /availability body + slots vs slotsDetail consistency (Step 11).
 * Timing: API AVAILABILITY_TIMING_RESPONSE_HEADER=1 + K6_PRINT_AVAILABILITY_TIMING=1 → logs X-Availability-Timing JSON per GET.
 */

import http from 'k6/http';
import { fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

/** Matches `AvailabilityQueryDto` @Max(192). */
const DEFAULT_MAX_SLOTS_PER_ROW = 192;

function stripBearer(v) {
  return String(v || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

const AUTH_TOKEN = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
const BUSINESS_ID = (__ENV.BUSINESS_ID || __ENV.TEST_BUSINESS_ID || '').trim();

const STAFF_IDS = (__ENV.STAFF_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SERVICE_IDS = (__ENV.SERVICE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CUSTOMER_IDS = (__ENV.CUSTOMER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const BOOK_DURATION_FALLBACK = Number(__ENV.BOOK_DURATION_MINUTES || '45');
const SLOT_INDEX = Math.max(0, parseInt(__ENV.K6_SLOT_INDEX || '0', 10) || 0);
const EXPLICIT_DATE = (__ENV.K6_CORRECTNESS_DATE || '').trim().slice(0, 10);

/** Must match prisma seed `APPOINTMENT_ANCHOR_YMD` + booking window when you change the seed. */
const SEED_APPOINTMENT_ANCHOR_YMD = (__ENV.K6_SEED_ANCHOR_YMD || '2026-04-07').trim().slice(0, 10);

const correctnessAborts = new Counter('correctness_aborts');

/** k6 teardown runs in init context — VU mutations are not visible here; use handleSummary for PASS/FAIL. */
const summary = { status: 'PASS', steps: [], skipped: [] };

export const options = {
  scenarios: {
    correctness_full: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '20m',
    },
  },
};

export function teardown() {
  console.log(
    '\n(teardown runs in k6 init context — step buffer here is not updated by the VU; see handleSummary below)\n',
  );
}

export function handleSummary(data) {
  const aborts = data.metrics.correctness_aborts?.values?.count ?? 0;
  const iters = data.metrics.iterations?.values?.count ?? 0;
  let statusLine;
  if (iters < 1) {
    statusLine = 'STATUS: INCOMPLETE (setup error or zero iterations — see k6 error above)';
  } else if (aborts > 0) {
    statusLine = 'STATUS: FAIL (assert/abort path)';
  } else {
    statusLine = 'STATUS: PASS';
  }
  const lines = [
    '\n========== K6 CORRECTNESS SUMMARY ==========',
    `iterations: ${iters}`,
    `correctness_aborts: ${aborts}`,
    statusLine,
    '===========================================\n',
  ];
  return { stdout: lines.join('\n') };
}

function recordStep(name, ok, detail) {
  summary.steps.push({ name, ok, ...detail });
}

function skipStep(name, reason) {
  summary.skipped.push({ name, reason });
  console.log(`[SKIP] ${name}: ${reason}`);
}

function logStep(title, payload) {
  console.log(`[STEP] ${title} ${JSON.stringify(payload)}`);
}

function abort(msg, ctx) {
  correctnessAborts.add(1);
  summary.status = 'FAIL';
  const extra = ctx !== undefined ? ` ${JSON.stringify(ctx)}` : '';
  console.error(`❌ FAIL: ${msg}${extra}`);
  fail(`${msg}${extra}`);
}

function assert(cond, msg, ctx) {
  if (!cond) abort(msg, ctx);
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

function isHttp2xx(r) {
  const s = r.status;
  return s === 200 || s === 201;
}

function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
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

function errorBodySnippet(res, max = 500) {
  const t = String(res.body || '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function mergeTags(endpoint, tags) {
  return { endpoint, ...(tags || {}) };
}

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
  const merged = {
    ...params,
    days: params.days ?? 1,
    maxSlotsPerRow: params.maxSlotsPerRow ?? DEFAULT_MAX_SLOTS_PER_ROW,
    chronologicalSlots: params.chronologicalSlots !== false,
  };
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
    tags: mergeTags('hold', tags),
  });
}

function createBooking(payload, headers, tags) {
  return http.post(`${API_BASE}/appointments/book`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('booking', tags),
  });
}

function cancelAppointment(payload, headers, tags) {
  return http.post(`${API_BASE}/appointments/cancel`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('cancel', tags),
  });
}

function rescheduleBooking(appointmentId, payload, headers, tags) {
  return http.patch(`${API_BASE}/appointments/${appointmentId}`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('reschedule', tags),
  });
}

function slotHoldOk(res) {
  if (!isHttp2xx(res)) return false;
  const b = safeJson(res);
  return !!(b && b.hold && typeof b.hold.id === 'string');
}

function holdIdFrom(res) {
  const b = safeJson(res);
  return b && b.hold && b.hold.id ? b.hold.id : null;
}

function bookOk(res) {
  if (!isHttp2xx(res)) return false;
  const b = safeJson(res);
  return !!(b && typeof b.id === 'string');
}

function appointmentIdFrom(res) {
  const b = safeJson(res);
  return b && b.id ? b.id : null;
}

function parseK6ServiceDurationMap() {
  const raw = String(__ENV.K6_SERVICE_DURATIONS || '').trim();
  const map = Object.create(null);
  if (!raw) return map;
  for (const piece of raw.split(',')) {
    const idx = piece.indexOf(':');
    if (idx <= 0) continue;
    const id = piece.slice(0, idx).trim();
    const n = Number(piece.slice(idx + 1).trim());
    if (id && Number.isFinite(n) && n > 0) {
      map[idNorm(id)] = Math.floor(n);
    }
  }
  return map;
}

const K6_SERVICE_DURATION_MAP = parseK6ServiceDurationMap();

function bookingDurationForService(serviceId) {
  if (!serviceId) return BOOK_DURATION_FALLBACK;
  const d = K6_SERVICE_DURATION_MAP[idNorm(serviceId)];
  if (Number.isFinite(d) && d > 0) return d;
  return BOOK_DURATION_FALLBACK;
}

function fetchAvailabilityBlockByStaffService(token, businessId) {
  const headers = authHeaders(token);
  const qs = toQueryString({ businessId });
  const r = http.get(`${API_BASE}/services?${qs}`, {
    headers,
    tags: mergeTags('setup_services', {}),
  });
  const out = Object.create(null);
  if (r.status !== 200) return out;
  const list = safeJson(r);
  if (!Array.isArray(list)) return out;
  for (const s of list) {
    if (!s || !s.id) continue;
    const svcId = s.id;
    const baseDur = Number(s.durationMinutes) || 0;
    const bufB = Number(s.bufferBeforeMinutes ?? 0) || 0;
    const bufA = Number(s.bufferAfterMinutes ?? 0) || 0;
    const staffSvcs = Array.isArray(s.staffServices) ? s.staffServices : [];
    for (const ss of staffSvcs) {
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

function availabilityBlockMinutes(data, staffId, serviceId) {
  const map = data.availabilityBlockByStaffService;
  if (map && staffId && serviceId) {
    const k = `${idNorm(staffId)}|${idNorm(serviceId)}`;
    const v = map[k];
    if (Number.isFinite(v) && v > 0) return Math.max(1, Math.floor(v));
  }
  return bookingDurationForService(serviceId);
}

/** API returns `AvailabilityResult[]` (array). Some gateways/wrappers may nest — normalize here. */
function parseAvailabilityRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  return [];
}

/**
 * When K6_AV_RAW_DEBUG=1: log res.body as-is, then parse and list slots without matching slotsDetail.
 * Does not use safeJson for the initial log (raw string only).
 */
function debugAvailabilitySlotsVsDetail(res, staffId, label) {
  if (__ENV.K6_AV_RAW_DEBUG !== '1') return;
  const tag = label || 'availability';
  console.log(`\n=== K6_AV_RAW_DEBUG ${tag}: raw body string ===\n${String(res.body || '')}\n=== end raw ===\n`);
  let raw;
  try {
    raw = JSON.parse(String(res.body || 'null'));
  } catch (e) {
    console.log(`K6_AV_RAW_DEBUG ${tag}: JSON.parse failed`, String(e));
    return;
  }
  const rows = parseAvailabilityRows(raw);
  const topShape = Array.isArray(raw) ? 'array' : typeof raw;
  console.log(
    `K6_AV_RAW_DEBUG ${tag}: topShape=${topShape} rows.length=${rows.length} status=${res.status}`,
  );
  if (raw && Array.isArray(raw.results) && raw.results[0]) {
    const r0 = raw.results[0];
    const n0 = Array.isArray(r0.slots) ? r0.slots.length : 'n/a';
    const d0 = Array.isArray(r0.slotsDetail) ? r0.slotsDetail.length : r0.slotsDetail === undefined ? 'undefined' : 'non-array';
    console.log(
      `K6_AV_RAW_DEBUG ${tag}: raw.results[0] staffId=${r0.staffId} slots.length=${n0} slotsDetail.len/type=${d0} (target staffId=${staffId})`,
    );
  }
  const row = rowForStaff(rows, staffId);
  if (!row) {
    console.log(`K6_AV_RAW_DEBUG ${tag}: no row for staffId=${staffId}`);
    return;
  }
  const slots = Array.isArray(row.slots) ? row.slots : [];
  const det = row.slotsDetail;
  const detLen = Array.isArray(det) ? det.length : det === undefined ? 'undefined' : 'non-array';
  console.log(`K6_AV_RAW_DEBUG ${tag}: slots.length=${slots.length} slotsDetail len/type=${detLen}`);
  if (!Array.isArray(det) || det.length === 0) {
    if (slots.length > 0) {
      console.log(
        `K6_AV_RAW_DEBUG ${tag}: INCONSISTENCY — slots non-empty but slotsDetail missing/empty (check compact=1 or server bug).`,
      );
    }
    return;
  }
  slots.forEach((s) => {
    const found = det.find((d) => d && d.businessTime === s);
    if (!found) console.log(`K6_AV_RAW_DEBUG ${tag}: MISSING slotsDetail for slot=${s}`);
  });
}

function rowForStaff(body, staffId) {
  const rows = parseAvailabilityRows(body);
  if (rows.length === 0) return null;
  return rows.find((r) => r && idNorm(r.staffId) === idNorm(staffId)) || null;
}

/**
 * Resolve staff + 1–2 services + customer from API (no STAFF_IDS in .env).
 */
function resolveFixtureFromHttp(businessId, token) {
  const headers = authHeaders(token);
  const staffR = http.get(
    `${API_BASE}/staff?${toQueryString({ businessId, limit: 100, page: 1 })}`,
    { headers },
  );
  if (staffR.status !== 200) {
    throw new Error(
      `GET /staff ${staffR.status} — need staff:read. ${errorBodySnippet(staffR, 400)}`,
    );
  }
  const staffList = safeJson(staffR);
  if (!Array.isArray(staffList) || staffList.length === 0) {
    throw new Error('GET /staff returned empty list — seed staff for this business');
  }
  const staffId = staffList[0].id;

  const svcR = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, { headers });
  if (svcR.status !== 200) {
    throw new Error(
      `GET /services ${svcR.status} — need service:read. ${errorBodySnippet(svcR, 400)}`,
    );
  }
  const serviceList = safeJson(svcR);
  if (!Array.isArray(serviceList) || serviceList.length === 0) {
    throw new Error('GET /services returned empty — seed services');
  }

  /** Prefer 25m service as primary (stable grid for date scan); second = any other offered */
  const offeredServices = serviceList.filter((s) =>
    (s.staffServices || []).some(
      (ss) =>
        ss &&
        ss.staffId &&
        idNorm(ss.staffId) === idNorm(staffId) &&
        ss.allowBooking !== false,
    ),
  );
  const preferred =
    offeredServices.find((s) => Number(s.durationMinutes) === 25) || offeredServices[0];
  const serviceAId = preferred ? preferred.id : null;
  const other = offeredServices.find((s) => idNorm(s.id) !== idNorm(serviceAId || ''));
  const serviceBId = other ? other.id : null;
  if (!serviceAId) {
    throw new Error('No service offers booking for first staff — check staff_services');
  }

  const custR = http.get(`${API_BASE}/customers?${toQueryString({ businessId })}`, { headers });
  if (custR.status !== 200) {
    throw new Error(
      `GET /customers ${custR.status} — need business:read on customers. ${errorBodySnippet(custR, 400)}`,
    );
  }
  const custList = safeJson(custR);
  if (!Array.isArray(custList) || custList.length === 0) {
    throw new Error('GET /customers empty — seed customers');
  }
  const customerId = custList[0].id;
  const customerAltId = custList.length > 1 ? custList[1].id : null;

  console.log(
    JSON.stringify({
      fixtureSource: 'http',
      staffId,
      serviceAId,
      serviceBId,
      customerId,
      customerAltId,
      staffCount: staffList.length,
      serviceCount: serviceList.length,
      customerCount: custList.length,
    }),
  );

  return { staffId, serviceAId, serviceBId, customerId, customerAltId };
}

function slotsForRow(res, staffId) {
  const rows = safeJson(res);
  const row = rowForStaff(rows, staffId);
  return row && Array.isArray(row.slots) ? row.slots : [];
}

function fallbackYmdsFromEnvAndAnchor() {
  const raw = (__ENV.K6_FALLBACK_DATES || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim().slice(0, 10))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  }
  const out = [];
  const anchor =
    SEED_APPOINTMENT_ANCHOR_YMD && /^\d{4}-\d{2}-\d{2}$/.test(SEED_APPOINTMENT_ANCHOR_YMD)
      ? SEED_APPOINTMENT_ANCHOR_YMD
      : '2026-04-07';
  for (let i = 0; i < 14; i++) {
    const d = new Date(`${anchor}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function fetchSlotsForYmd(headers, data, staffId, serviceId, ymd) {
  const r = getAvailability(
    {
      businessId: data.businessId,
      date: ymd,
      staffId,
      serviceId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  return { r, slots: r.status === 200 ? slotsForRow(r, staffId) : [] };
}

/** Deterministic: first date in [startOff..endOff] with >= minSlots slots for staff+svc */
function resolveTestDate(headers, data, staffId, serviceId, minSlots, startOff, endOff) {
  if (EXPLICIT_DATE && /^\d{4}-\d{2}-\d{2}$/.test(EXPLICIT_DATE)) {
    logStep('date.resolve', { source: 'K6_CORRECTNESS_DATE', date: EXPLICIT_DATE });
    return EXPLICIT_DATE;
  }
  let firstErrLogged = false;
  const tryYmd = (ymd, source) => {
    const { r, slots } = fetchSlotsForYmd(headers, data, staffId, serviceId, ymd);
    if (r.status !== 200 && !firstErrLogged) {
      firstErrLogged = true;
      console.warn(
        `[date.resolve] first non-200 availability (${r.status}) ${errorBodySnippet(r, 300)}`,
      );
    }
    if (r.status === 200 && slots.length >= minSlots) {
      logStep('date.resolve', {
        source,
        date: ymd,
        minSlots,
        foundSlots: slots.length,
        hint: 'set K6_CORRECTNESS_DATE for fixed runs',
      });
      return ymd;
    }
    return null;
  };

  const base = new Date();
  for (let off = startOff; off <= endOff; off++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + off);
    const ymd = d.toISOString().slice(0, 10);
    const hit = tryYmd(ymd, 'utc_scan');
    if (hit) return hit;
    sleep(0.02);
  }

  for (const ymd of fallbackYmdsFromEnvAndAnchor()) {
    const hit = tryYmd(ymd, 'seed_anchor_fallback');
    if (hit) return hit;
    sleep(0.02);
  }
  return null;
}

export function setup() {
  if (!BUSINESS_ID) throw new Error('BUSINESS_ID required');
  if (!AUTH_TOKEN) throw new Error('AUTH_TOKEN required');

  let staffId;
  let serviceAId;
  let serviceBId;
  let customerId;
  let customerAltId;

  if (STAFF_IDS.length && SERVICE_IDS.length && CUSTOMER_IDS.length) {
    staffId = STAFF_IDS[0];
    serviceAId = SERVICE_IDS[0];
    serviceBId = SERVICE_IDS.length > 1 ? SERVICE_IDS[1] : null;
    customerId = CUSTOMER_IDS[0];
    customerAltId = CUSTOMER_IDS.length > 1 ? CUSTOMER_IDS[1] : null;
    console.log(JSON.stringify({ fixtureSource: 'env' }));
  } else {
    const fx = resolveFixtureFromHttp(BUSINESS_ID, AUTH_TOKEN);
    staffId = fx.staffId;
    serviceAId = fx.serviceAId;
    serviceBId = fx.serviceBId;
    customerId = fx.customerId;
    customerAltId = fx.customerAltId;
  }

  const headers = authHeaders(AUTH_TOKEN);
  const probe = getAvailability(
    {
      businessId: BUSINESS_ID,
      date: new Date().toISOString().slice(0, 10),
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: 8,
      chronologicalSlots: true,
    },
    headers,
  );
  if (probe.status === 401) throw new Error('GET /availability 401 — invalid JWT');
  if (probe.status === 403) throw new Error('GET /availability 403 — missing permission');

  const availabilityBlockByStaffService = fetchAvailabilityBlockByStaffService(
    AUTH_TOKEN,
    BUSINESS_ID,
  );

  return {
    businessId: BUSINESS_ID,
    token: AUTH_TOKEN,
    staffId,
    serviceAId,
    serviceBId,
    customerId,
    customerAltId: customerAltId || null,
    availabilityBlockByStaffService,
  };
}

export default function (data) {
  const headers = { ...authHeaders(data.token), 'Content-Type': 'application/json' };

  const staffId = data.staffId;
  const serviceAId = data.serviceAId;
  const serviceBId = data.serviceBId;
  const customerId = data.customerId;
  const customerAltId = data.customerAltId || null;

  console.log('\n========== K6 FULL BOOKING CORRECTNESS ==========\n');

  // --- Shared date: need 2+ slots for main flow + reschedule ---
  const testDate =
    resolveTestDate(headers, data, staffId, serviceAId, 2, 1, 28) ||
    resolveTestDate(headers, data, staffId, serviceAId, 1, 1, 28);
  assert(testDate, 'Could not find a day with availability (adjust K6_CORRECTNESS_DATE or data)', {
    staffId,
    serviceId: serviceAId,
  });
  recordStep('resolve_date', true, { date: testDate });

  const durA = availabilityBlockMinutes(data, staffId, serviceAId);

  // -------------------------------------------------------------------------
  // 1) Fetch availability
  // -------------------------------------------------------------------------
  const av1 = getAvailability(
    {
      businessId: data.businessId,
      date: testDate,
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  assert(isHttp2xx(av1), 'Step1 GET /availability failed', {
    status: av1.status,
    body: errorBodySnippet(av1),
  });
  const slotsBefore = sortSlotsChrono(slotsForRow(av1, staffId));
  assert(slotsBefore.length > 0, 'Step1 no slots (ghost closed day or misconfiguration)', {
    date: testDate,
  });
  logStep('1.availability.initial', {
    status: av1.status,
    slotCount: slotsBefore.length,
    slotsSample: slotsBefore.slice(0, 12),
  });
  recordStep('availability_initial', true, {
    status: av1.status,
    slotCount: slotsBefore.length,
  });

  assert(
    SLOT_INDEX < slotsBefore.length,
    `K6_SLOT_INDEX=${SLOT_INDEX} out of range (${slotsBefore.length} slots)`,
    { slots: slotsBefore.slice(0, 20) },
  );
  const selectedSlot = slotsBefore[SLOT_INDEX];
  const secondSlot = slotsBefore.find((s) => s !== selectedSlot) || null;
  assert(secondSlot, 'Need a second distinct slot on same day for reschedule test', {
    slotsBefore,
  });

  logStep('2.pick', { selectedSlot, secondSlot, slotIndex: SLOT_INDEX, durationMinutes: durA });

  // -------------------------------------------------------------------------
  // 3) Hold — expect success (201 Created or 200 OK)
  // -------------------------------------------------------------------------
  const hold1 = createSlotHold(
    {
      businessId: data.businessId,
      staffId,
      serviceId: serviceAId,
      customerId,
      date: testDate,
      startTime: selectedSlot,
      durationMinutes: durA,
    },
    headers,
    { step: 'hold_first' },
  );
  assert(
    hold1.status === 200 || hold1.status === 201,
    'Step3 first hold expected 200/201',
    { status: hold1.status, body: errorBodySnippet(hold1) },
  );
  assert(slotHoldOk(hold1), 'Step3 hold response missing hold.id', {
    status: hold1.status,
    body: errorBodySnippet(hold1),
  });
  const holdId1 = holdIdFrom(hold1);
  logStep('3.hold.first', { status: hold1.status, holdId: holdId1, selectedSlot });
  recordStep('hold_first', true, { status: hold1.status });

  // -------------------------------------------------------------------------
  // 4) Second hold same slot → 409
  // -------------------------------------------------------------------------
  const hold2 = createSlotHold(
    {
      businessId: data.businessId,
      staffId,
      serviceId: serviceAId,
      customerId,
      date: testDate,
      startTime: selectedSlot,
      durationMinutes: durA,
    },
    headers,
    { step: 'hold_duplicate', expected_response: 'true' },
  );
  assert(
    hold2.status === 409,
    'Step4 duplicate hold expected 409',
    { status: hold2.status, body: errorBodySnippet(hold2) },
  );
  logStep('4.hold.duplicate', { status: hold2.status, selectedSlot });
  recordStep('hold_duplicate_409', true, { status: hold2.status });

  // -------------------------------------------------------------------------
  // 5) Complete booking from first hold
  // -------------------------------------------------------------------------
  const book1 = createBooking(
    {
      businessId: data.businessId,
      slotHoldId: holdId1,
    },
    headers,
    { step: 'book_from_hold' },
  );
  assert(isHttp2xx(book1) && bookOk(book1), 'Step5 book expected 2xx + appointment id', {
    status: book1.status,
    body: errorBodySnippet(book1),
  });
  const appointmentId = appointmentIdFrom(book1);
  logStep('5.book', { status: book1.status, appointmentId });
  recordStep('book_ok', true, { status: book1.status, appointmentId });

  // -------------------------------------------------------------------------
  // 6) Availability: selected slot must NOT appear (no ghost bookable slot)
  // -------------------------------------------------------------------------
  const av2 = getAvailability(
    {
      businessId: data.businessId,
      date: testDate,
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  assert(isHttp2xx(av2), 'Step6 GET /availability failed', { status: av2.status });
  const slotsAfterBook = sortSlotsChrono(slotsForRow(av2, staffId));
  assert(
    !slotsAfterBook.includes(selectedSlot),
    'Step6 booked slot still listed — availability/DB mismatch',
    { selectedSlot, slotsAfterBook: slotsAfterBook.slice(0, 30) },
  );
  logStep('6.availability.after_book', {
    status: av2.status,
    slotCount: slotsAfterBook.length,
    slotsSample: slotsAfterBook.slice(0, 12),
    selectedSlotRemoved: true,
  });
  recordStep('availability_after_book', true, { status: av2.status, slotCount: slotsAfterBook.length });

  // -------------------------------------------------------------------------
  // 7) Cancel booking
  // -------------------------------------------------------------------------
  const cancel1 = cancelAppointment(
    {
      appointmentId,
      businessId: data.businessId,
      reason: 'k6 correctness',
    },
    headers,
    { step: 'cancel' },
  );
  assert(isHttp2xx(cancel1), 'Step7 cancel expected 2xx', {
    status: cancel1.status,
    body: errorBodySnippet(cancel1),
  });
  logStep('7.cancel', { status: cancel1.status, appointmentId });
  recordStep('cancel_ok', true, { status: cancel1.status });

  // -------------------------------------------------------------------------
  // 8) Availability: slot MUST reappear
  // -------------------------------------------------------------------------
  const av3 = getAvailability(
    {
      businessId: data.businessId,
      date: testDate,
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  assert(isHttp2xx(av3), 'Step8 GET /availability failed', { status: av3.status });
  const slotsAfterCancel = sortSlotsChrono(slotsForRow(av3, staffId));
  assert(
    slotsAfterCancel.includes(selectedSlot),
    'Step8 canceled slot not listed — missing slot / cache inconsistency',
    { selectedSlot, slotsAfterCancel: slotsAfterCancel.slice(0, 30) },
  );
  logStep('8.availability.after_cancel', {
    status: av3.status,
    slotCount: slotsAfterCancel.length,
    slotsSample: slotsAfterCancel.slice(0, 12),
    selectedSlotRestored: true,
  });
  recordStep('availability_after_cancel', true, {
    status: av3.status,
    slotCount: slotsAfterCancel.length,
  });

  // -------------------------------------------------------------------------
  // 9) Different service duration → availability set should change
  // -------------------------------------------------------------------------
  if (!serviceBId) {
    skipStep(
      'service_duration_compare',
      'only one bookable service for fixture staff — add another service on that staff',
    );
  } else {
    const durB = availabilityBlockMinutes(data, staffId, serviceBId);
    const avSvcA = getAvailability(
      {
        businessId: data.businessId,
        date: testDate,
        staffId,
        serviceId: serviceAId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
    );
    const avSvcB = getAvailability(
      {
        businessId: data.businessId,
        date: testDate,
        staffId,
        serviceId: serviceBId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
    );
    assert(isHttp2xx(avSvcA) && isHttp2xx(avSvcB), 'Step9 GET /availability for both services', {
      a: avSvcA.status,
      b: avSvcB.status,
    });
    const listA = sortSlotsChrono(slotsForRow(avSvcA, staffId));
    const listB = sortSlotsChrono(slotsForRow(avSvcB, staffId));
    logStep('9.availability.service_compare', {
      statusA: avSvcA.status,
      statusB: avSvcB.status,
      blockMinutesA: durA,
      blockMinutesB: durB,
      countA: listA.length,
      countB: listB.length,
    });
    if (durA === durB && JSON.stringify(listA) === JSON.stringify(listB)) {
      skipStep(
        'service_duration_compare',
        'services have identical block minutes and identical slot lists — cannot assert difference',
      );
    } else {
      assert(
        JSON.stringify(listA) !== JSON.stringify(listB) || listA.length !== listB.length,
        'Step9 expected different availability for different service duration',
        { listA: listA.slice(0, 20), listB: listB.slice(0, 20), durA, durB },
      );
      recordStep('service_duration_availability', true, {
        countA: listA.length,
        countB: listB.length,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 10) Invalid / constructed slot → 400 or 409 or 422
  // -------------------------------------------------------------------------
  const invalidHolds = [
    { label: 'out_of_day', startTime: '01:15' },
    { label: 'garbage_time', startTime: '25:99' },
  ];
  for (const inv of invalidHolds) {
    const ir = createSlotHold(
      {
        businessId: data.businessId,
        staffId,
        serviceId: serviceAId,
        customerId,
        date: testDate,
        startTime: inv.startTime,
        durationMinutes: durA,
      },
      headers,
      { step: 'invalid_hold', expected_response: 'true' },
    );
    const bad = ir.status === 400 || ir.status === 409 || ir.status === 422;
    assert(
      bad,
      `Step10 invalid slot ${inv.label} expected 400/409/422 got ${ir.status}`,
      { body: errorBodySnippet(ir) },
    );
    logStep(`10.invalid_hold.${inv.label}`, { status: ir.status, startTime: inv.startTime });
    recordStep(`invalid_hold_${inv.label}`, true, { status: ir.status });
  }

  // -------------------------------------------------------------------------
  // 11) Reschedule flow: book → move → old free, new occupied
  // -------------------------------------------------------------------------
  const avR0 = getAvailability(
    {
      businessId: data.businessId,
      date: testDate,
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 0,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  assert(isHttp2xx(avR0), 'Step11a GET /availability (detail) failed', { status: avR0.status });
  debugAvailabilitySlotsVsDetail(avR0, staffId, 'Step11.avR0');
  const row0 = rowForStaff(safeJson(avR0), staffId);
  const sorted0 = sortSlotsChrono(row0 && row0.slots ? row0.slots : []);
  assert(
    SLOT_INDEX < sorted0.length,
    'Step11: not enough slots for K6_SLOT_INDEX',
    { sorted0: sorted0.slice(0, 15), SLOT_INDEX },
  );
  const slotOld = sorted0[SLOT_INDEX];
  const endOldMin = hhmmToMinutes(slotOld) + durA;
  const slotNewCandidate =
    sorted0.find((s) => hhmmToMinutes(s) >= endOldMin) || sorted0[SLOT_INDEX + 1] || null;
  assert(slotOld && slotNewCandidate && slotOld !== slotNewCandidate, 'Step11 need two separable slots', {
    sorted0,
    durA,
    slotOld,
  });

  const detailRow = row0 && Array.isArray(row0.slotsDetail) ? row0.slotsDetail : [];
  const detNew = detailRow.find((d) => d && d.businessTime === slotNewCandidate);
  assert(detNew && detNew.startUtc, 'Step11 slotsDetail missing for new slot', {
    slotNewCandidate,
    detailLen: detailRow.length,
  });

  const hRes = createSlotHold(
    {
      businessId: data.businessId,
      staffId,
      serviceId: serviceAId,
      customerId,
      date: testDate,
      startTime: slotOld,
      durationMinutes: durA,
    },
    headers,
    { step: 'hold_reschedule_flow' },
  );
  assert(slotHoldOk(hRes), 'Step11 hold for reschedule flow', {
    status: hRes.status,
    body: errorBodySnippet(hRes),
  });
  const bRes = createBooking(
    { businessId: data.businessId, slotHoldId: holdIdFrom(hRes) },
    headers,
    { step: 'book_reschedule_flow' },
  );
  assert(bookOk(bRes), 'Step11 book for reschedule flow', {
    status: bRes.status,
    body: errorBodySnippet(bRes),
  });
  const aptR = appointmentIdFrom(bRes);

  const newStart = new Date(detNew.startUtc);
  const newEnd = new Date(newStart.getTime() + durA * 60 * 1000);
  const patchR = rescheduleBooking(
    aptR,
    {
      businessId: data.businessId,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
    },
    headers,
    { step: 'patch_reschedule' },
  );
  assert(patchR.status === 200, 'Step11 reschedule PATCH expected 200', {
    status: patchR.status,
    body: errorBodySnippet(patchR),
  });

  const avR1 = getAvailability(
    {
      businessId: data.businessId,
      date: testDate,
      staffId,
      serviceId: serviceAId,
      days: 1,
      compact: 1,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
      chronologicalSlots: true,
    },
    headers,
  );
  assert(isHttp2xx(avR1), 'Step11 GET /availability after reschedule failed', {
    status: avR1.status,
  });
  const slotsR1 = sortSlotsChrono(slotsForRow(avR1, staffId));
  assert(
    slotsR1.includes(slotOld),
    'Step11 old slot should be available after reschedule',
    { slotOld, slotsR1: slotsR1.slice(0, 40) },
  );
  assert(
    !slotsR1.includes(slotNewCandidate),
    'Step11 new slot should be occupied after reschedule',
    { slotNewCandidate, slotsR1: slotsR1.slice(0, 40) },
  );
  logStep('11.reschedule', {
    statusPatch: patchR.status,
    slotOld,
    slotNew: slotNewCandidate,
    slotsAfter: slotsR1.slice(0, 16),
  });
  recordStep('reschedule_old_free_new_busy', true, { appointmentId: aptR });

  // Cleanup: cancel rescheduled appointment
  const cancelR = cancelAppointment(
    { appointmentId: aptR, businessId: data.businessId, reason: 'k6 cleanup' },
    headers,
    { step: 'cancel_after_reschedule' },
  );
  assert(isHttp2xx(cancelR), 'cleanup cancel failed', { status: cancelR.status });

  // -------------------------------------------------------------------------
  // 12) DB vs availability hint: overlapping hold → 409; refresh must drop slot (no “broken” book)
  //     Sequential race (same JWT, two customers). DB / EXCLUDE is source of truth — client retries + refresh.
  // -------------------------------------------------------------------------
  if (!customerAltId || idNorm(customerAltId) === idNorm(customerId)) {
    skipStep(
      '12.availability_db_race',
      'need 2 distinct CUSTOMER_IDS or ≥2 customers in GET /customers',
    );
  } else {
    const avRace0 = getAvailability(
      {
        businessId: data.businessId,
        date: testDate,
        staffId,
        serviceId: serviceAId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
    );
    assert(isHttp2xx(avRace0), 'Step12 GET /availability failed', { status: avRace0.status });
    const slotsRace0 = sortSlotsChrono(slotsForRow(avRace0, staffId));
    assert(slotsRace0.length > 0, 'Step12 no slots', { testDate });
    const raceIdx = Math.min(5, slotsRace0.length - 1);
    const raceSlot = slotsRace0[raceIdx];

    const h12a = createSlotHold(
      {
        businessId: data.businessId,
        staffId,
        serviceId: serviceAId,
        customerId,
        date: testDate,
        startTime: raceSlot,
        durationMinutes: durA,
      },
      headers,
      { step: 'race_hold_primary' },
    );
    assert(slotHoldOk(h12a), 'Step12a first hold must succeed', {
      status: h12a.status,
      body: errorBodySnippet(h12a),
    });
    const hold12Id = holdIdFrom(h12a);

    const h12b = createSlotHold(
      {
        businessId: data.businessId,
        staffId,
        serviceId: serviceAId,
        customerId: customerAltId,
        date: testDate,
        startTime: raceSlot,
        durationMinutes: durA,
      },
      headers,
      { step: 'race_hold_overlapping' },
    );
    assert(
      h12b.status === 409,
      'Step12b overlapping hold must be 409 (DB blocks race; availability is a hint)',
      { status: h12b.status, body: errorBodySnippet(h12b), raceSlot },
    );
    logStep('12.race.second_hold_409', { raceSlot, status: h12b.status });

    const avRace1 = getAvailability(
      {
        businessId: data.businessId,
        date: testDate,
        staffId,
        serviceId: serviceAId,
        days: 1,
        compact: 1,
        maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
        chronologicalSlots: true,
      },
      headers,
    );
    assert(isHttp2xx(avRace1), 'Step12 refresh GET /availability failed', { status: avRace1.status });
    const slotsRace1 = sortSlotsChrono(slotsForRow(avRace1, staffId));
    assert(
      !slotsRace1.includes(raceSlot),
      'Step12c refresh must not offer slot while live hold covers it',
      { raceSlot, slotsSample: slotsRace1.slice(0, 20) },
    );
    logStep('12.race.refresh_excludes_slot', {
      raceSlot,
      slotCount: slotsRace1.length,
    });

    const b12 = createBooking(
      { businessId: data.businessId, slotHoldId: hold12Id },
      headers,
      { step: 'race_cleanup_book' },
    );
    assert(bookOk(b12), 'Step12d book from surviving hold', {
      status: b12.status,
      body: errorBodySnippet(b12),
    });
    const apt12 = appointmentIdFrom(b12);
    const cancel12 = cancelAppointment(
      { appointmentId: apt12, businessId: data.businessId, reason: 'k6 step12 cleanup' },
      headers,
      { step: 'race_cleanup_cancel' },
    );
    assert(isHttp2xx(cancel12), 'Step12 cleanup cancel failed', { status: cancel12.status });
    recordStep('availability_db_race', true, { raceSlot });
  }

  console.log('\n========== K6 FULL CORRECTNESS: ALL STEPS OK ==========\n');
}