/**
 * k6 — Cache consistency: hold a slot, immediately re-check availability.
 *
 * For each VU:
 *   1. GET /availability → pick a slot
 *   2. POST /slot-holds (hold that slot) → 201
 *   3. GET /availability IMMEDIATELY → assert slot NOT in response
 *
 * Counter `cache_stale` tracks violations. Threshold: cache_stale == 0.
 *
 * Env: BUSINESS_ID, AUTH_TOKEN (or K6_AUTH_TOKEN)
 *   K6_CACHE_VUS (default 10)
 *   K6_CACHE_ITERATIONS (default 5, per VU)
 */

import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

const CACHE_VUS = Math.max(1, parseInt(__ENV.K6_CACHE_VUS || '10', 10) || 10);
const CACHE_ITERS = Math.max(1, parseInt(__ENV.K6_CACHE_ITERATIONS || '5', 10) || 5);
const BOOK_DURATION_FALLBACK = Number(__ENV.BOOK_DURATION_MINUTES || '45');
const LATENCY_P95 = parseInt(__ENV.K6_LATENCY_P95_MS || '3000', 10) || 3000;

const cache_stale = new Counter('cache_stale');
const cache_checked = new Counter('cache_checked');
const trend_hold_ms = new Trend('cache_hold_duration_ms', true);

export const options = {
  scenarios: {
    cache_consistency: {
      executor: 'per-vu-iterations',
      vus: CACHE_VUS,
      iterations: CACHE_ITERS,
      maxDuration: '10m',
    },
  },
  thresholds: {
    cache_stale: ['count == 0'],
    'http_req_duration{expected_response:true}': [`p(95)<${LATENCY_P95}`],
  },
};

function stripBearer(v) {
  return String(v || '').trim().replace(/^Bearer\s+/i, '').trim();
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
  try { return res.body ? JSON.parse(res.body) : null; }
  catch (_) { return null; }
}

function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function idNorm(id) {
  return String(id || '').toLowerCase().replace(/-/g, '');
}

function hhmmToMinutes(hhmm) {
  const parts = String(hhmm).trim().split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function sortSlotsChrono(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
}

function rowForStaff(body, staffId) {
  let rows = Array.isArray(body) ? body : (body && body.results) || [];
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r && idNorm(r.staffId) === idNorm(staffId)) || null;
}

function slotsForRow(res, staffId) {
  const rows = safeJson(res);
  const row = rowForStaff(rows, staffId);
  return row && Array.isArray(row.slots) ? row.slots : [];
}

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
  for (const s of list) {
    if (!s || !s.id) continue;
    const baseDur = Number(s.durationMinutes) || 0;
    const bufB = Number(s.bufferBeforeMinutes) || 0;
    const bufA = Number(s.bufferAfterMinutes) || 0;
    const staffSvcs = Array.isArray(s.staffServices) ? s.staffServices : [];
    for (const ss of staffSvcs) {
      if (!ss || !ss.staffId) continue;
      const ssDur = Number(ss.durationMinutes) || 0;
      const serviceMinutes = (ssDur > 0 ? ssDur : baseDur) || 30;
      const block = serviceMinutes + bufB + bufA;
      out[`${idNorm(ss.staffId)}|${idNorm(s.id)}`] = Math.max(1, Math.floor(block));
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
  return BOOK_DURATION_FALLBACK;
}

function resolveFixtureFromHttp(businessId, token) {
  const headers = authHeaders(token);
  const staffR = http.get(`${API_BASE}/staff?${toQueryString({ businessId, limit: 100, page: 1 })}`, { headers });
  if (staffR.status !== 200) throw new Error(`GET /staff ${staffR.status}`);
  const staffList = safeJson(staffR);
  if (!Array.isArray(staffList) || !staffList.length) throw new Error('No staff');
  const staffId = staffList[0].id;

  const svcR = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, { headers });
  if (svcR.status !== 200) throw new Error(`GET /services ${svcR.status}`);
  const svcList = safeJson(svcR);
  if (!Array.isArray(svcList) || !svcList.length) throw new Error('No services');
  const offered = svcList.filter((s) =>
    (s.staffServices || []).some(
      (ss) => ss && ss.staffId && idNorm(ss.staffId) === idNorm(staffId) && ss.allowBooking !== false,
    ),
  );
  const svcId = (offered[0] || svcList[0]).id;

  const custR = http.get(`${API_BASE}/customers?${toQueryString({ businessId })}`, { headers });
  if (custR.status !== 200) throw new Error(`GET /customers ${custR.status}`);
  const custList = safeJson(custR);
  if (!Array.isArray(custList) || !custList.length) throw new Error('No customers');

  return { staffId, serviceId: svcId, customerIds: custList.map((c) => c.id) };
}

function findTestDate(businessId, staffId, serviceId, token, minSlots) {
  const headers = authHeaders(token);
  for (let off = 0; off <= 28; off++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + off);
    const ymd = d.toISOString().slice(0, 10);
    const av = http.get(
      `${API_BASE}/availability?${toQueryString({
        businessId,
        staffId,
        serviceId,
        date: ymd,
        days: 1,
        compact: 1,
        maxSlotsPerRow: 192,
        chronologicalSlots: true,
      })}`,
      { headers },
    );
    if (av.status !== 200) continue;
    const row = rowForStaff(safeJson(av), staffId);
    const slots = sortSlotsChrono(row && row.slots ? row.slots : []);
    if (slots.length >= minSlots) return { ymd, slots };
    sleep(0.02);
  }
  return null;
}

export function setup() {
  const businessId = (__ENV.BUSINESS_ID || __ENV.TEST_BUSINESS_ID || '').trim();
  const token = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
  if (!businessId) throw new Error('BUSINESS_ID required');
  if (!token) throw new Error('AUTH_TOKEN required');

  const fx = resolveFixtureFromHttp(businessId, token);
  const blockMap = fetchAvailabilityBlockByStaffService(token, businessId);

  const dateResult = findTestDate(businessId, fx.staffId, fx.serviceId, token, CACHE_VUS + 2);
  if (!dateResult) throw new Error('No date with enough slots');

  return {
    businessId,
    token,
    staffId: fx.staffId,
    serviceId: fx.serviceId,
    customerIds: fx.customerIds,
    testDate: dateResult.ymd,
    blockMap,
  };
}

export default function (data) {
  const vu = __VU;
  const iter = __ITER;
  const headers = { ...authHeaders(data.token), 'Content-Type': 'application/json' };
  const customerId = data.customerIds[(vu - 1) % data.customerIds.length];
  const dur = durationMinutesForHold(data.blockMap, data.staffId, data.serviceId);

  // 1. GET availability
  const av1 = http.get(
    `${API_BASE}/availability?${toQueryString({
      businessId: data.businessId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      date: data.testDate,
      days: 1,
      compact: 1,
      maxSlotsPerRow: 192,
      chronologicalSlots: true,
    })}`,
    { headers, tags: { endpoint: 'avail_before' } },
  );
  if (av1.status !== 200) return;

  const slotsBefore = sortSlotsChrono(slotsForRow(av1, data.staffId));
  // Pick a unique slot per VU+iter to avoid inter-VU contention clouding results
  const slotIndex = ((vu - 1) * CACHE_ITERS + iter) % slotsBefore.length;
  const targetSlot = slotsBefore[slotIndex];
  if (!targetSlot) return;

  // 2. POST hold
  const holdRes = http.post(
    `${API_BASE}/appointments/slot-holds`,
    JSON.stringify({
      businessId: data.businessId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      customerId,
      date: data.testDate,
      startTime: targetSlot,
      durationMinutes: dur,
    }),
    { headers, tags: { endpoint: 'hold' } },
  );
  trend_hold_ms.add(holdRes.timings.duration);

  if (holdRes.status !== 200 && holdRes.status !== 201) {
    // 409 = another VU got it first; not a cache bug
    return;
  }

  // 3. GET availability IMMEDIATELY — slot must NOT appear
  const av2 = http.get(
    `${API_BASE}/availability?${toQueryString({
      businessId: data.businessId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      date: data.testDate,
      days: 1,
      compact: 1,
      maxSlotsPerRow: 192,
      chronologicalSlots: true,
    })}`,
    { headers, tags: { endpoint: 'avail_after' } },
  );

  cache_checked.add(1);

  if (av2.status === 200) {
    const slotsAfter = sortSlotsChrono(slotsForRow(av2, data.staffId));
    const stillThere = slotsAfter.includes(targetSlot);
    check(null, {
      'held slot removed from availability': () => !stillThere,
    });
    if (stillThere) {
      cache_stale.add(1);
      console.error(
        JSON.stringify({
          tag: 'CACHE_STALE',
          vu,
          iter,
          targetSlot,
          date: data.testDate,
          staffId: data.staffId,
        }),
      );
    }
  }

  // Cleanup: book + cancel so the hold doesn't linger and block future VUs
  const body = safeJson(holdRes);
  const holdId = body && body.hold && body.hold.id ? body.hold.id : null;
  if (holdId) {
    const bookRes = http.post(
      `${API_BASE}/appointments/book`,
      JSON.stringify({ businessId: data.businessId, slotHoldId: holdId }),
      { headers, tags: { endpoint: 'book_cleanup' } },
    );
    const bookBody = safeJson(bookRes);
    const aptId = bookBody && bookBody.id ? bookBody.id : null;
    if (aptId) {
      http.post(
        `${API_BASE}/appointments/cancel`,
        JSON.stringify({
          appointmentId: aptId,
          businessId: data.businessId,
          reason: 'k6 cache-consistency cleanup',
        }),
        { headers, tags: { endpoint: 'cancel_cleanup' } },
      );
    }
  }
}

export function handleSummary(data) {
  const stale = (data.metrics.cache_stale && data.metrics.cache_stale.values && data.metrics.cache_stale.values.count) || 0;
  const checked = (data.metrics.cache_checked && data.metrics.cache_checked.values && data.metrics.cache_checked.values.count) || 0;
  const lines = [
    '\n========== K6 CACHE CONSISTENCY ==========',
    `cache_checked: ${checked}`,
    `cache_stale: ${stale}`,
    `RESULT: ${stale === 0 ? 'PASS' : 'FAIL'}`,
    '==========================================\n',
    textSummary(data, { indent: ' ', enableColors: false }),
  ];
  return { stdout: lines.join('\n') };
}
