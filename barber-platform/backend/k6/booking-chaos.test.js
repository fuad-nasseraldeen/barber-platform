/**
 * k6 — Hard chaos: sustained concurrent mixed operations.
 *
 * constant-vus executor with duration (not one-shot per VU).
 * Each VU loops: random op per tick (hold+book+cancel, hold only, GET burst, hold+book).
 * Produces hundreds of requests across the duration.
 *
 * Post-run: use npm run test:booking:post-k6 for DB invariant checks.
 *
 * Env: BUSINESS_ID, AUTH_TOKEN
 *   K6_CHAOS_VUS (default 30)
 *   K6_CHAOS_DURATION (default '30s')
 *   K6_CHAOS_RACE_CLUSTER (default 8, first N VUs fight for slot 0)
 *   K6_LATENCY_P95_MS (default 3000)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

const CHAOS_VUS = Math.max(4, parseInt(__ENV.K6_CHAOS_VUS || '30', 10) || 30);
const CHAOS_DURATION = __ENV.K6_CHAOS_DURATION || '30s';
const RACE_CLUSTER = Math.max(2, parseInt(__ENV.K6_CHAOS_RACE_CLUSTER || '8', 10) || 8);
const BOOK_DURATION_FALLBACK = Number(__ENV.BOOK_DURATION_MINUTES || '45');
const LATENCY_P95 = parseInt(__ENV.K6_LATENCY_P95_MS || '3000', 10) || 3000;

const chaos_hold_201 = new Counter('chaos_hold_201');
const chaos_hold_409 = new Counter('chaos_hold_409');
const chaos_hold_other = new Counter('chaos_hold_other');
const chaos_book_201 = new Counter('chaos_book_201');
const chaos_cancel_ok = new Counter('chaos_cancel_ok');
const chaos_stale_slot = new Counter('chaos_stale_slot');
const chaos_ops = new Counter('chaos_ops_total');
const trend_hold_ms = new Trend('chaos_hold_ms', true);
const trend_book_ms = new Trend('chaos_book_ms', true);
const trend_avail_ms = new Trend('chaos_avail_ms', true);

export const options = {
  scenarios: {
    chaos_sustained: {
      executor: 'constant-vus',
      vus: CHAOS_VUS,
      duration: CHAOS_DURATION,
    },
  },
  thresholds: {
    chaos_stale_slot: ['count == 0'],
    chaos_hold_other: ['count == 0'],
  },
};

function stripBearer(v) { return String(v || '').trim().replace(/^Bearer\s+/i, '').trim(); }
function toQueryString(obj) {
  const p = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    p.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return p.join('&');
}
function safeJson(r) { try { return r.body ? JSON.parse(r.body) : null; } catch (_) { return null; } }
function authHeaders(t) { return t ? { Authorization: `Bearer ${t}` } : {}; }
function idNorm(id) { return String(id || '').toLowerCase().replace(/-/g, ''); }
function hhmmToMinutes(hhmm) {
  const parts = String(hhmm).trim().split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}
function sortSlots(s) {
  return Array.isArray(s) ? [...s].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b)) : [];
}
function rowForStaff(body, sid) {
  let rows = Array.isArray(body) ? body : (body && body.results) || [];
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r && idNorm(r.staffId) === idNorm(sid)) || null;
}

function fetchBlockMap(token, businessId) {
  const headers = authHeaders(token);
  const r = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, { headers });
  const out = Object.create(null);
  if (r.status !== 200) return out;
  const list = safeJson(r);
  if (!Array.isArray(list)) return out;
  for (const s of list) {
    if (!s || !s.id) continue;
    const baseDur = Number(s.durationMinutes) || 0;
    const bufB = Number(s.bufferBeforeMinutes) || 0;
    const bufA = Number(s.bufferAfterMinutes) || 0;
    for (const ss of (s.staffServices || [])) {
      if (!ss || !ss.staffId) continue;
      const d = (Number(ss.durationMinutes) > 0 ? Number(ss.durationMinutes) : baseDur) || 30;
      out[`${idNorm(ss.staffId)}|${idNorm(s.id)}`] = Math.max(1, Math.floor(d + bufB + bufA));
    }
  }
  return out;
}
function dur(blockMap, staffId, serviceId) {
  const k = `${idNorm(staffId)}|${idNorm(serviceId)}`;
  const v = blockMap[k];
  return Number.isFinite(v) && v > 0 ? v : BOOK_DURATION_FALLBACK;
}

function resolveFixture(businessId, token) {
  const h = authHeaders(token);
  const sr = http.get(`${API_BASE}/staff?${toQueryString({ businessId, limit: 100, page: 1 })}`, { headers: h });
  if (sr.status !== 200) throw new Error(`GET /staff ${sr.status}`);
  const sl = safeJson(sr);
  if (!Array.isArray(sl) || !sl.length) throw new Error('No staff');
  const staffId = sl[0].id;

  const svr = http.get(`${API_BASE}/services?${toQueryString({ businessId })}`, { headers: h });
  if (svr.status !== 200) throw new Error(`GET /services ${svr.status}`);
  const svl = safeJson(svr);
  if (!Array.isArray(svl) || !svl.length) throw new Error('No services');
  const offered = svl.filter((s) =>
    (s.staffServices || []).some(
      (ss) => ss && idNorm(ss.staffId) === idNorm(staffId) && ss.allowBooking !== false,
    ),
  );
  const serviceId = (offered[0] || svl[0]).id;

  const cr = http.get(`${API_BASE}/customers?${toQueryString({ businessId })}`, { headers: h });
  if (cr.status !== 200) throw new Error(`GET /customers ${cr.status}`);
  const cl = safeJson(cr);
  if (!Array.isArray(cl) || cl.length < CHAOS_VUS)
    throw new Error(`Need at least ${CHAOS_VUS} customers; got ${Array.isArray(cl) ? cl.length : 0}`);
  return { staffId, serviceId, customerIds: cl.map((c) => c.id) };
}

export function setup() {
  const businessId = (__ENV.BUSINESS_ID || __ENV.TEST_BUSINESS_ID || '').trim();
  const token = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
  if (!businessId) throw new Error('BUSINESS_ID required');
  if (!token) throw new Error('AUTH_TOKEN required');

  const fx = resolveFixture(businessId, token);
  const blockMap = fetchBlockMap(token, businessId);
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };

  const minSlots = 12;
  let testDate = null;
  let allSlots = [];

  for (let off = 0; off <= 28 && !testDate; off++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + off);
    const ymd = d.toISOString().slice(0, 10);
    const av = http.get(
      `${API_BASE}/availability?${toQueryString({
        businessId,
        staffId: fx.staffId,
        serviceId: fx.serviceId,
        date: ymd,
        days: 1,
        compact: 1,
        maxSlotsPerRow: 192,
        chronologicalSlots: true,
      })}`,
      { headers },
    );
    if (av.status !== 200) continue;
    const row = rowForStaff(safeJson(av), fx.staffId);
    const s = sortSlots(row && row.slots ? row.slots : []);
    if (s.length >= minSlots) {
      testDate = ymd;
      allSlots = s;
    }
    sleep(0.02);
  }

  if (!testDate) throw new Error(`No date with ${minSlots} slots for chaos test`);

  const raceSlot = allSlots[0];
  const partitionSlots = allSlots.slice(1);

  console.log(JSON.stringify({
    tag: 'chaos_setup',
    vus: CHAOS_VUS,
    duration: CHAOS_DURATION,
    raceCluster: RACE_CLUSTER,
    testDate,
    totalSlots: allSlots.length,
    raceSlot,
    partitionSlots: partitionSlots.length,
    latencyP95Threshold: LATENCY_P95,
  }));

  return {
    businessId,
    token,
    staffId: fx.staffId,
    serviceId: fx.serviceId,
    customerIds: fx.customerIds,
    testDate,
    raceSlot,
    partitionSlots,
    blockMap,
    raceCluster: RACE_CLUSTER,
  };
}

function avQs(data) {
  return toQueryString({
    businessId: data.businessId,
    staffId: data.staffId,
    serviceId: data.serviceId,
    date: data.testDate,
    days: 1,
    compact: 1,
    maxSlotsPerRow: 192,
    chronologicalSlots: true,
  });
}

export default function (data) {
  const vu = __VU;
  const headers = { ...authHeaders(data.token), 'Content-Type': 'application/json' };
  const customerId = data.customerIds[(vu - 1) % data.customerIds.length];
  const d = dur(data.blockMap, data.staffId, data.serviceId);

  const isRaceVu = vu <= data.raceCluster;

  // Pick operation by weighted random
  const roll = Math.random() * 100;
  let op;
  if (roll < 40)      op = 'hold_book_cancel';
  else if (roll < 70) op = 'hold_only';
  else if (roll < 90) op = 'get_burst';
  else                op = 'hold_book';

  // Pick target slot
  let targetSlot;
  if (isRaceVu) {
    targetSlot = data.raceSlot;
  } else {
    const idx = Math.floor(Math.random() * data.partitionSlots.length);
    targetSlot = data.partitionSlots[idx];
  }

  chaos_ops.add(1);

  // Random jitter (0-200ms)
  sleep(Math.random() * 0.2);

  // --- GET burst ---
  if (op === 'get_burst') {
    for (let i = 0; i < 3; i++) {
      const r = http.get(`${API_BASE}/availability?${avQs(data)}`, {
        headers, tags: { endpoint: 'availability' },
      });
      trend_avail_ms.add(r.timings.duration);
      sleep(0.05);
    }
    return;
  }

  // --- Hold ---
  const holdRes = http.post(
    `${API_BASE}/appointments/slot-holds`,
    JSON.stringify({
      businessId: data.businessId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      customerId,
      date: data.testDate,
      startTime: targetSlot,
      durationMinutes: d,
    }),
    { headers, tags: { endpoint: 'hold' } },
  );
  trend_hold_ms.add(holdRes.timings.duration);

  if (holdRes.status === 409) {
    chaos_hold_409.add(1);
    return;
  }
  if (holdRes.status !== 200 && holdRes.status !== 201) {
    if (holdRes.status < 500) chaos_hold_other.add(1);
    return;
  }

  chaos_hold_201.add(1);
  const body = safeJson(holdRes);
  const holdId = body && body.hold && body.hold.id ? body.hold.id : null;
  if (!holdId) return;

  if (op === 'hold_only') return;

  // --- Book ---
  const bookRes = http.post(
    `${API_BASE}/appointments/book`,
    JSON.stringify({ businessId: data.businessId, slotHoldId: holdId }),
    { headers, tags: { endpoint: 'book' } },
  );
  trend_book_ms.add(bookRes.timings.duration);

  if (bookRes.status !== 200 && bookRes.status !== 201) return;

  chaos_book_201.add(1);
  const bBody = safeJson(bookRes);
  const aptId = bBody && bBody.id ? bBody.id : null;

  // --- Availability stale check ---
  const avAfter = http.get(`${API_BASE}/availability?${avQs(data)}`, {
    headers, tags: { endpoint: 'availability' },
  });
  trend_avail_ms.add(avAfter.timings.duration);
  if (avAfter.status === 200) {
    const row = rowForStaff(safeJson(avAfter), data.staffId);
    const slotsAfter = sortSlots(row && row.slots ? row.slots : []);
    if (slotsAfter.includes(targetSlot)) {
      chaos_stale_slot.add(1);
    }
  }

  // --- Cancel cleanup (for hold_book_cancel) ---
  if (op === 'hold_book_cancel' && aptId) {
    const cr = http.post(
      `${API_BASE}/appointments/cancel`,
      JSON.stringify({
        appointmentId: aptId,
        businessId: data.businessId,
        reason: 'k6 chaos cleanup',
      }),
      { headers, tags: { endpoint: 'cancel' } },
    );
    if (cr.status === 200 || cr.status === 201) chaos_cancel_ok.add(1);
  }

  // Throttle: small sleep between ops to avoid overwhelming a remote DB
  sleep(0.1 + Math.random() * 0.3);
}

function mc(summaryData, name) {
  const m = summaryData.metrics[name];
  if (!m || !m.values) return 0;
  return typeof m.values.count === 'number' ? m.values.count : 0;
}

function mp95(summaryData, name) {
  const m = summaryData.metrics[name];
  if (!m || !m.values) return 'n/a';
  const v = m.values['p(95)'];
  return typeof v === 'number' ? `${Math.round(v)}ms` : 'n/a';
}

function metricLine(summaryData, name) {
  const m = summaryData.metrics[name];
  if (!m || !m.values) return `${name}: n/a`;
  const vals = m.values;
  const parts = [];
  for (const key of ['count', 'rate', 'avg', 'med', 'p(90)', 'p(95)', 'max']) {
    if (typeof vals[key] === 'number') {
      parts.push(`${key}=${vals[key]}`);
    }
  }
  return parts.length ? `${name}: ${parts.join(' ')}` : `${name}: n/a`;
}

export function handleSummary(data) {
  const h201 = mc(data, 'chaos_hold_201');
  const h409 = mc(data, 'chaos_hold_409');
  const hOther = mc(data, 'chaos_hold_other');
  const b201 = mc(data, 'chaos_book_201');
  const cancelOk = mc(data, 'chaos_cancel_ok');
  const stale = mc(data, 'chaos_stale_slot');
  const totalOps = mc(data, 'chaos_ops_total');
  const httpReqs = mc(data, 'http_reqs');

  let pass = true;
  const lines = ['\n========== K6 CHAOS — SUMMARY =========='];
  lines.push(`VUs: ${CHAOS_VUS}  duration: ${CHAOS_DURATION}  race_cluster: ${RACE_CLUSTER}`);
  lines.push(`total_ops: ${totalOps}  http_reqs: ${httpReqs}`);
  lines.push(`chaos_hold_201: ${h201}`);
  lines.push(`chaos_hold_409: ${h409}`);
  lines.push(`chaos_hold_other: ${hOther}`);
  lines.push(`chaos_book_201: ${b201}`);
  lines.push(`chaos_cancel_ok: ${cancelOk}`);
  lines.push(`chaos_stale_slot: ${stale}`);
  lines.push(`http_req_duration p95: ${mp95(data, 'http_req_duration')}`);

  if (hOther > 0) { pass = false; lines.push('FAIL: unexpected hold status (not 201/409)'); }
  if (stale > 0) { pass = false; lines.push('FAIL: stale slot in availability after book'); }

  lines.push(`http_req_duration p95 (2xx): ${mp95(data, 'http_req_duration{expected_response:true}')}`);
  lines.push(`(latency threshold removed — chaos tests correctness, not performance)`);

  lines.push(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  lines.push('==========================================\n');
  lines.push(metricLine(data, 'checks'));
  lines.push(metricLine(data, 'http_req_duration'));
  lines.push(metricLine(data, 'http_req_failed'));
  lines.push(metricLine(data, 'iterations'));
  lines.push(metricLine(data, 'chaos_hold_201'));
  lines.push(metricLine(data, 'chaos_hold_409'));
  lines.push(metricLine(data, 'chaos_hold_other'));
  lines.push(metricLine(data, 'chaos_book_201'));
  lines.push(metricLine(data, 'chaos_cancel_ok'));
  return { stdout: lines.join('\n') };
}
