import http from 'k6/http';
import { fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

const AUTH_TOKEN = String(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '')
  .trim()
  .replace(/^Bearer\s+/i, '');
const BUSINESS_ID = String(__ENV.BUSINESS_ID || __ENV.TEST_BUSINESS_ID || '').trim();

export const options = {
  scenarios: {
    reschedule_slot_sync: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '5m',
    },
  },
};

function assert(cond, msg, ctx) {
  if (!cond) {
    const extra = ctx ? ` ${JSON.stringify(ctx)}` : '';
    fail(`${msg}${extra}`);
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function q(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

function safeJson(res) {
  try {
    return JSON.parse(String(res.body || 'null'));
  } catch {
    return null;
  }
}

function hhmmToMin(v) {
  const [h, m] = String(v).split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

function sortSlots(slots) {
  return [...(Array.isArray(slots) ? slots : [])].sort((a, b) => hhmmToMin(a) - hhmmToMin(b));
}

function rowForStaff(body, staffId) {
  const rows = Array.isArray(body) ? body : [];
  return rows.find((r) => r && r.staffId === staffId) || null;
}

function resolveFixture() {
  const headers = authHeaders();
  const staffRes = http.get(`${API_BASE}/staff?${q({ businessId: BUSINESS_ID, page: 1, limit: 50 })}`, { headers });
  assert(staffRes.status === 200, 'GET /staff failed', { status: staffRes.status });
  const staff = safeJson(staffRes);
  assert(Array.isArray(staff) && staff.length > 0, 'no staff found');
  const staffId = staff[0].id;

  const svcRes = http.get(`${API_BASE}/services?${q({ businessId: BUSINESS_ID })}`, { headers });
  assert(svcRes.status === 200, 'GET /services failed', { status: svcRes.status });
  const services = safeJson(svcRes);
  assert(Array.isArray(services) && services.length > 0, 'no services found');
  const service =
    services.find((s) => Number(s.durationMinutes) === 25) ||
    services.find((s) => Array.isArray(s.staffServices) && s.staffServices.some((ss) => ss && ss.staffId === staffId && ss.allowBooking !== false)) ||
    services[0];
  const serviceId = service.id;
  const durationMinutes = Math.max(1, Number(service.durationMinutes) || 25);

  const custRes = http.get(`${API_BASE}/customers?${q({ businessId: BUSINESS_ID })}`, { headers });
  assert(custRes.status === 200, 'GET /customers failed', { status: custRes.status });
  const customers = safeJson(custRes);
  assert(Array.isArray(customers) && customers.length > 0, 'no customers found');
  const customerId = customers[0].id;

  return { staffId, serviceId, customerId, durationMinutes };
}

function findDateWithTwoSlots(headers, fixture) {
  for (let i = 1; i <= 28; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    const av = http.get(`${API_BASE}/availability?${q({
      businessId: BUSINESS_ID,
      date: ymd,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      days: 1,
      compact: 0,
      chronologicalSlots: true,
      maxSlotsPerRow: 192,
    })}`, { headers });
    if (av.status !== 200) continue;
    const row = rowForStaff(safeJson(av), fixture.staffId);
    const slots = sortSlots(row && row.slots ? row.slots : []);
    if (slots.length >= 2) return { date: ymd, row, slots };
  }
  return null;
}

export function setup() {
  assert(BUSINESS_ID, 'BUSINESS_ID is required');
  assert(AUTH_TOKEN, 'AUTH_TOKEN is required');
  return resolveFixture();
}

export default function (fixture) {
  const headers = authHeaders();
  const found = findDateWithTwoSlots(headers, fixture);
  assert(found, 'could not find a day with at least two slots');

  const oldSlot = found.slots[0];
  const minEnd = hhmmToMin(oldSlot) + fixture.durationMinutes;
  const newSlot = found.slots.find((s) => s !== oldSlot && hhmmToMin(s) >= minEnd) || found.slots[1];
  const details = Array.isArray(found.row && found.row.slotsDetail) ? found.row.slotsDetail : [];
  const detailNew = details.find((d) => d && d.businessTime === newSlot);
  assert(detailNew && detailNew.startUtc, 'missing slotsDetail for new slot', { newSlot });

  const hold = http.post(`${API_BASE}/appointments/slot-holds`, JSON.stringify({
    businessId: BUSINESS_ID,
    staffId: fixture.staffId,
    serviceId: fixture.serviceId,
    customerId: fixture.customerId,
    date: found.date,
    startTime: oldSlot,
    durationMinutes: fixture.durationMinutes,
  }), { headers });
  assert(hold.status === 200 || hold.status === 201, 'hold failed', { status: hold.status, body: hold.body });
  const holdId = (((safeJson(hold) || {}).hold || {}).id) || null;
  assert(holdId, 'hold id missing');

  const book = http.post(`${API_BASE}/appointments/book`, JSON.stringify({
    businessId: BUSINESS_ID,
    slotHoldId: holdId,
  }), { headers });
  assert(book.status === 200 || book.status === 201, 'book failed', { status: book.status, body: book.body });
  const appointmentId = (safeJson(book) || {}).id;
  assert(appointmentId, 'appointment id missing');

  const ns = new Date(detailNew.startUtc);
  const ne = new Date(ns.getTime() + fixture.durationMinutes * 60 * 1000);
  const patch = http.patch(`${API_BASE}/appointments/${appointmentId}`, JSON.stringify({
    businessId: BUSINESS_ID,
    startTime: ns.toISOString(),
    endTime: ne.toISOString(),
  }), { headers });
  assert(patch.status === 200, 'reschedule failed', { status: patch.status, body: patch.body });

  const after = http.get(`${API_BASE}/availability?${q({
    businessId: BUSINESS_ID,
    date: found.date,
    staffId: fixture.staffId,
    serviceId: fixture.serviceId,
    days: 1,
    compact: 1,
    chronologicalSlots: true,
    maxSlotsPerRow: 192,
  })}`, { headers });
  assert(after.status === 200, 'availability after reschedule failed', { status: after.status });
  const slotsAfter = sortSlots((rowForStaff(safeJson(after), fixture.staffId) || {}).slots || []);

  assert(slotsAfter.includes(oldSlot), 'old slot should be available after reschedule', {
    oldSlot,
    slotsAfter: slotsAfter.slice(0, 40),
  });
  assert(!slotsAfter.includes(newSlot), 'new slot should be unavailable after reschedule', {
    newSlot,
    slotsAfter: slotsAfter.slice(0, 40),
  });

  http.post(`${API_BASE}/appointments/cancel`, JSON.stringify({
    appointmentId,
    businessId: BUSINESS_ID,
    reason: 'reschedule-slot-sync cleanup',
  }), { headers });
}
