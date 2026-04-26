/**
 * k6 — Booking API latency (low VU ramp, tagged sub-metrics, slow-request logging).
 *
 * Endpoints (actual routes):
 *   GET  /api/v1/availability
 *   POST /api/v1/appointments/slot-holds
 *   POST /api/v1/appointments/book
 *   PATCH /api/v1/appointments/:id (reschedule)
 *
 * Flow per iteration: availability → hold → book → (optional) reschedule → cancel (cleanup).
 *
 * Env: BUSINESS_ID, AUTH_TOKEN, STAFF_IDS, SERVICE_IDS, CUSTOMER_IDS (same as other k6 scripts).
 * Optional: K6_CORRECTNESS_DATE=YYYY-MM-DD, K6_SKIP_RESCHEDULE=1, BASE_URL, API_PREFIX
 * Recommended: DISABLE_BOOKING_THROTTLE=1 on the API under test.
 *
 * Run:
 *   npm run k6:latency
 *   k6 run k6/booking-latency.test.js
 */

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;
/** Matches AvailabilityQueryDto @Max(192). */
const DEFAULT_MAX_SLOTS_PER_ROW = 192;
const SLOW_MS = 1000;
const SKIP_RESCHEDULE = __ENV.K6_SKIP_RESCHEDULE === '1';
const EXPLICIT_DATE = (__ENV.K6_CORRECTNESS_DATE || '').trim().slice(0, 10);

function stripBearer(v) {
  return String(v || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

const AUTH_TOKEN = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
const BUSINESS_ID = (__ENV.BUSINESS_ID || '').trim();
const STAFF_IDS = (__ENV.STAFF_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SERVICE_IDS = (__ENV.SERVICE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CUSTOMER_IDS = (__ENV.CUSTOMER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

const BOOK_FALLBACK = Number(__ENV.BOOK_DURATION_MINUTES || '45');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
  scenarios: {
    booking_latency: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:availability}': ['p(95)<800'],
    'http_req_duration{endpoint:hold}': ['p(95)<500'],
    'http_req_duration{endpoint:booking}': ['p(95)<500'],
    'http_req_duration{endpoint:reschedule}': ['p(95)<1000'],
    /** Contention / validation failures should stay rare */
    'http_req_failed{endpoint:availability}': ['rate<0.05'],
    'http_req_failed{endpoint:hold}': ['rate<0.1'],
    'http_req_failed{endpoint:booking}': ['rate<0.1'],
    'http_req_failed{endpoint:reschedule}': ['rate<0.15'],
  },
};

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

function sortSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
}

function logSlow(res, endpointLabel) {
  const d = res.timings.duration;
  if (d >= SLOW_MS) {
    console.warn(
      `[SLOW] ${endpointLabel} vu=${__VU} iter=${__ITER} duration_ms=${d.toFixed(1)} status=${res.status}`,
    );
  }
}

function logFailureContext(res, headers, label) {
  const bodySnippet = String(res && res.body ? res.body : '')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  const authPresent = !!(
    headers &&
    (headers.Authorization || headers.authorization)
  );
  console.error(
    `[FAIL_CTX] ${label} status=${res ? res.status : 'n/a'} url=${res && res.request ? res.request.url : 'n/a'} authPresent=${authPresent} bodySnippet=${bodySnippet}`,
  );
}

function mergeTags(endpoint, extra) {
  return { endpoint, ...(extra || {}) };
}

function availabilityHttpGet(params, headers, endpointTag) {
  const qs = toQueryString({
    ...params,
    days: params.days ?? 1,
    maxSlotsPerRow: params.maxSlotsPerRow ?? DEFAULT_MAX_SLOTS_PER_ROW,
    chronologicalSlots: true,
  });
  return http.get(`${API_BASE}/availability?${qs}`, {
    headers,
    tags: mergeTags(endpointTag),
  });
}

function getAvailability(params, headers) {
  return availabilityHttpGet(params, headers, 'availability');
}

function createSlotHold(payload, headers) {
  return http.post(`${API_BASE}/appointments/slot-holds`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('hold'),
  });
}

function createBooking(payload, headers) {
  return http.post(`${API_BASE}/appointments/book`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('booking'),
  });
}

function rescheduleBooking(appointmentId, payload, headers) {
  return http.patch(`${API_BASE}/appointments/${appointmentId}`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('reschedule'),
  });
}

function cancelAppointment(payload, headers) {
  return http.post(`${API_BASE}/appointments/cancel`, JSON.stringify(payload), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: mergeTags('cancel'),
  });
}

function parseDurationMap() {
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

const DURATION_MAP = parseDurationMap();

function fetchServices(token, businessId) {
  const r = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, {
    headers: authHeaders(token),
    tags: mergeTags('setup'),
  });
  if (r.status !== 200) return [];
  const list = safeJson(r);
  return Array.isArray(list) ? list : [];
}

function fetchStaff(token, businessId) {
  const r = http.get(`${API_BASE}/staff?${toQueryString({ businessId, limit: 100, page: 1 })}`, {
    headers: authHeaders(token),
    tags: mergeTags('setup'),
  });
  if (r.status !== 200) return [];
  const list = safeJson(r);
  return Array.isArray(list) ? list : [];
}

function fetchCustomers(token, businessId) {
  const r = http.get(`${API_BASE}/customers?${toQueryString({ businessId })}`, {
    headers: authHeaders(token),
    tags: mergeTags('setup'),
  });
  if (r.status !== 200) return [];
  const list = safeJson(r);
  return Array.isArray(list) ? list : [];
}

function resolveFixtureSelection(token, businessId, staffIds, serviceIds) {
  const staffList = fetchStaff(token, businessId);
  const services = fetchServices(token, businessId);
  const preferredStaffId = staffIds[0];
  const staffId = preferredStaffId || (staffList[0] && staffList[0].id) || null;
  const requestedServiceId = serviceIds[0] || null;
  if (!staffId || !services.length) {
    return { staffId, serviceId: requestedServiceId, services };
  }

  const offered = services.filter((s) =>
    (s.staffServices || []).some(
      (ss) =>
        ss &&
        idNorm(ss.staffId) === idNorm(staffId) &&
        ss.allowBooking !== false,
    ),
  );
  const envMatched = offered.find((s) =>
    serviceIds.some((id) => idNorm(id) === idNorm(s.id)),
  );
  const selected =
    envMatched ||
    (requestedServiceId && services.find((s) => s && idNorm(s.id) === idNorm(requestedServiceId))) ||
    offered[0] ||
    services[0] ||
    null;

  return {
    staffId,
    serviceId: selected ? selected.id : requestedServiceId,
    services,
  };
}

function fetchBlockMinutesFromServices(token, businessId, staffId, serviceId) {
  const list = fetchServices(token, businessId);
  if (!list.length) return BOOK_FALLBACK;
  return blockMinutesForServiceList(list, staffId, serviceId);
}

function blockMinutesForServiceList(list, staffId, serviceId) {
  const svc = list.find((s) => s && idNorm(s.id) === idNorm(serviceId));
  if (!svc) return DURATION_MAP[idNorm(serviceId)] || BOOK_FALLBACK;
  const baseDur = Number(svc.durationMinutes) || 0;
  const bufB = Number(svc.bufferBeforeMinutes ?? 0) || 0;
  const bufA = Number(svc.bufferAfterMinutes ?? 0) || 0;
  const staffSvcs = Array.isArray(svc.staffServices) ? svc.staffServices : [];
  const ss = staffSvcs.find((x) => x && idNorm(x.staffId) === idNorm(staffId));
  const ssDur = ss ? Number(ss.durationMinutes) || 0 : 0;
  const core = (ssDur > 0 ? ssDur : baseDur) || 30;
  return Math.max(1, Math.floor(core + bufB + bufA));
}

function resolveTestDate(headers, businessId, staffId, serviceId) {
  if (EXPLICIT_DATE && /^\d{4}-\d{2}-\d{2}$/.test(EXPLICIT_DATE)) return EXPLICIT_DATE;
  const base = new Date();
  for (let off = 1; off <= 21; off++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + off);
    const ymd = d.toISOString().slice(0, 10);
    const r = availabilityHttpGet(
      { businessId, date: ymd, staffId, serviceId, compact: 0, maxSlotsPerRow: 64 },
      headers,
      'setup',
    );
    if (r.status !== 200) continue;
    const body = safeJson(r);
    const row = Array.isArray(body)
      ? body.find((x) => x && idNorm(x.staffId) === idNorm(staffId))
      : null;
    const slots = row && Array.isArray(row.slots) ? row.slots : [];
    if (slots.length >= 2) return ymd;
  }
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

export function setup() {
  if (!BUSINESS_ID) throw new Error('BUSINESS_ID required');
  if (!AUTH_TOKEN) throw new Error('AUTH_TOKEN required');

  const fixture = resolveFixtureSelection(AUTH_TOKEN, BUSINESS_ID, STAFF_IDS, SERVICE_IDS);
  const staffId = fixture.staffId;
  const serviceId = fixture.serviceId;
  const customerId = CUSTOMER_IDS[0] || ((fetchCustomers(AUTH_TOKEN, BUSINESS_ID)[0] || {}).id ?? null);
  if (!staffId || !serviceId || !customerId) {
    throw new Error('Could not resolve staff/service/customer fixture for latency test');
  }
  const headers = { ...authHeaders(AUTH_TOKEN), 'Content-Type': 'application/json' };

  const testDate = resolveTestDate(headers, BUSINESS_ID, staffId, serviceId);
  const durationMinutes = fixture.services.length
    ? blockMinutesForServiceList(fixture.services, staffId, serviceId)
    : fetchBlockMinutesFromServices(AUTH_TOKEN, BUSINESS_ID, staffId, serviceId);

  return {
    businessId: BUSINESS_ID,
    token: AUTH_TOKEN,
    staffId,
    serviceId,
    customerId,
    testDate,
    durationMinutes,
  };
}

export default function (data) {
  const headers = { ...authHeaders(data.token), 'Content-Type': 'application/json' };

  /** Deterministic slot spread: VU/iteration index, no Math.random */
  const spread = (__VU - 1 + __ITER * 11) % 997;

  const av = getAvailability(
    {
      businessId: data.businessId,
      date: data.testDate,
      staffId: data.staffId,
      serviceId: data.serviceId,
      compact: 0,
      maxSlotsPerRow: DEFAULT_MAX_SLOTS_PER_ROW,
    },
    headers,
  );
  logSlow(av, 'availability');
  const avOk = check(av, { 'availability 200': (r) => r.status === 200 });
  if (!avOk) {
    logFailureContext(av, headers, 'availability');
    return;
  }

  const rows = safeJson(av);
  const row = Array.isArray(rows)
    ? rows.find((r) => r && idNorm(r.staffId) === idNorm(data.staffId))
    : null;
  const slots = sortSlots(row && row.slots ? row.slots : []);
  const details = row && Array.isArray(row.slotsDetail) ? row.slotsDetail : [];

  if (slots.length === 0) return;

  const si = spread % slots.length;
  const slotA = slots[si];
  const dur = data.durationMinutes;
  const endA = hhmmToMinutes(slotA) + dur;
  let slotB =
    slots.find((s) => s !== slotA && hhmmToMinutes(s) >= endA) || null;
  if (!slotB && slots.length > 1) {
    slotB = slots.find((s) => s !== slotA) || null;
  }

  const hold = createSlotHold(
    {
      businessId: data.businessId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      customerId: data.customerId,
      date: data.testDate,
      startTime: slotA,
      durationMinutes: dur,
    },
    headers,
  );
  logSlow(hold, 'hold');
  const holdOk = check(hold, { 'hold 2xx': (r) => r.status === 200 || r.status === 201 });
  if (!holdOk) {
    logFailureContext(hold, headers, 'hold');
    return;
  }

  const holdBody = safeJson(hold);
  const holdId = holdBody && holdBody.hold && holdBody.hold.id ? holdBody.hold.id : null;
  if (!holdId) return;

  const book = createBooking(
    { businessId: data.businessId, slotHoldId: holdId },
    headers,
  );
  logSlow(book, 'booking');
  const bookOk = check(book, {
    'booking 2xx': (r) => r.status === 200 || r.status === 201,
  });
  if (!bookOk) {
    logFailureContext(book, headers, 'booking');
    return;
  }

  const bookBody = safeJson(book);
  const appointmentId = bookBody && bookBody.id ? bookBody.id : null;
  if (!appointmentId) return;

  if (!SKIP_RESCHEDULE && slotB) {
    const detB = details.find((d) => d && d.businessTime === slotB && d.startUtc);
    if (detB && detB.startUtc) {
      const newStart = new Date(detB.startUtc);
      const newEnd = new Date(newStart.getTime() + dur * 60 * 1000);
      const patch = rescheduleBooking(
        appointmentId,
        {
          businessId: data.businessId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
        headers,
      );
      logSlow(patch, 'reschedule');
      const patchOk = check(patch, { 'reschedule 200': (r) => r.status === 200 });
      if (!patchOk) {
        logFailureContext(patch, headers, 'reschedule');
      }
    }
  }

  const cancel = cancelAppointment(
    {
      appointmentId,
      businessId: data.businessId,
      reason: 'k6 latency cleanup',
    },
    headers,
  );
  logSlow(cancel, 'cancel');
}

function readTrend(metric) {
  if (!metric || !metric.values) return null;
  const v = metric.values;
  return {
    avg: v.avg,
    min: v.min,
    med: v.med,
    max: v.max,
    p90: v['p(90)'],
    p95: v['p(95)'],
  };
}

function readRate(metric) {
  if (!metric || !metric.values) return null;
  return metric.values.rate;
}

export function handleSummary(data) {
  const lines = [];
  lines.push('');
  lines.push('========== BOOKING LATENCY — PER ENDPOINT ==========');

  const reportEndpoints = ['availability', 'hold', 'booking', 'reschedule', 'cancel', 'setup'];
  const worstAmong = ['availability', 'hold', 'booking', 'reschedule'];
  const durKeys = {};
  const failKeys = {};
  for (const ep of reportEndpoints) {
    durKeys[ep] = `http_req_duration{endpoint:${ep}}`;
    failKeys[ep] = `http_req_failed{endpoint:${ep}}`;
  }

  let worst = { endpoint: '(none)', p95: -1 };

  for (const ep of worstAmong) {
    const d = data.metrics[durKeys[ep]];
    const t = readTrend(d);
    if (t && t.p95 != null && t.p95 > worst.p95) {
      worst = { endpoint: ep, p95: t.p95 };
    }
  }

  for (const ep of reportEndpoints) {
    const d = data.metrics[durKeys[ep]];
    const f = data.metrics[failKeys[ep]];
    const t = readTrend(d);
    const rate = readRate(f);

    lines.push(`--- ${ep} ---`);
    if (t) {
      lines.push(
        `  duration_ms  avg=${t.avg?.toFixed(1)}  p90=${t.p90?.toFixed(1)}  p95=${t.p95?.toFixed(1)}  max=${t.max?.toFixed(1)}`,
      );
    } else {
      lines.push('  duration_ms  (no samples)');
    }
    if (rate != null) {
      lines.push(`  http_req_failed rate=${(rate * 100).toFixed(2)}%`);
    } else {
      lines.push('  http_req_failed (no tagged series)');
    }
  }

  const globalFail = data.metrics.http_req_failed;
  if (globalFail && globalFail.values) {
    lines.push(`--- ALL REQUESTS ---`);
    lines.push(`  http_req_failed rate=${(globalFail.values.rate * 100).toFixed(2)}%`);
  }

  lines.push('');
  lines.push(`WORST p(95) by endpoint: ${worst.endpoint} @ ${worst.p95 >= 0 ? worst.p95.toFixed(1) : 'n/a'} ms`);
  lines.push(`Thresholds: availability p95<800ms | hold p95<500ms | booking p95<500ms | reschedule p95<1000ms`);
  lines.push('====================================================');
  lines.push('');

  return { stdout: lines.join('\n') };
}
