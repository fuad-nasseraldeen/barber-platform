import http from 'k6/http';
import { fail, group } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = __ENV.API_PREFIX || 'api/v1';
const API_BASE = `${BASE_URL}/${API_PREFIX}`;

const SEED_BUSINESS = 'a0000001-0000-4000-8000-000000000001';
const SEED_STAFF = 'a0000001-0000-4000-8000-000000000003';
const SEED_CUSTOMER = 'a0000001-0000-4000-8000-000000000004';
const SEED_SERVICE_15 = 'a0000001-0000-4000-8000-000000000015';
const SEED_SERVICE_25 = 'a0000001-0000-4000-8000-000000000025';
const SEED_SERVICE_35 = 'a0000001-0000-4000-8000-000000000035';
const TEST_YMD = '2026-04-10';
const INVALID_SLOT_TRIES = ['12:07', '13:13', '11:11', '16:22', '10:03'];

const LIMIT_MS = {
  availability: 200,
  hold: 150,
  booking: 200,
  reschedule: 250,
  cancel: 150,
};

export const availability_duration = new Trend('availability_duration');
export const hold_duration = new Trend('hold_duration');
export const booking_duration = new Trend('booking_duration');
export const reschedule_duration = new Trend('reschedule_duration');
export const cancel_duration = new Trend('cancel_duration');

const LIGHT_START = __ENV.K6_LIGHT_START || '120s';

export const options = {
  scenarios: {
    correctness: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '15m',
      exec: 'runCorrectness',
    },
    light_availability_hold: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      startTime: LIGHT_START,
      exec: 'runLightAvailabilityHold',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
    availability_duration: ['p(95)<200'],
    hold_duration: ['p(95)<150'],
    booking_duration: ['p(95)<200'],
    reschedule_duration: ['p(95)<250'],
    cancel_duration: ['p(95)<150'],
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
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
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

function authH(t) {
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function logReq(kind, res) {
  const ms = res.timings.duration;
  const st = res.status;
  const lab = st >= 200 && st < 300 ? 'OK' : st === 409 ? 'CONFLICT' : 'ERR';
  console.log(`[${kind}] ${ms.toFixed(0)}ms ${st} ${lab}`);
}

function assert(cond, msg, ctx) {
  if (!cond) {
    console.error(JSON.stringify({ fail: msg, ctx }));
    fail(msg);
  }
}

function assertMax(kind, ms, maxMs) {
  assert(
    ms <= maxMs,
    `${kind} exceeded ${maxMs}ms (got ${ms.toFixed(1)}ms)`,
    { kind, ms, maxMs },
  );
}

function hhmmToMin(s) {
  const p = String(s).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

function idNorm(x) {
  return String(x || '')
    .toLowerCase()
    .replace(/-/g, '');
}

function sortSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort((a, b) => hhmmToMin(a) - hhmmToMin(b));
}

function rowForStaff(rows, staffId) {
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r && idNorm(r.staffId) === idNorm(staffId)) || null;
}

function getAvailability(headers, qsObj, step) {
  const qs = toQueryString({
    ...qsObj,
    days: qsObj.days ?? 1,
    maxSlotsPerRow: qsObj.maxSlotsPerRow ?? 192,
    chronologicalSlots: true,
  });
  let res;
  group('availability', () => {
    res = http.get(`${API_BASE}/availability?${qs}`, {
      headers,
      tags: { endpoint: 'availability', step },
    });
    const ms = res.timings.duration;
    availability_duration.add(ms);
    logReq('availability', res);
    assertMax('availability', ms, LIMIT_MS.availability);
  });
  return res;
}

function postSlotHold(headers, payload, tagHttp) {
  let res;
  group('hold', () => {
    res = http.post(`${API_BASE}/appointments/slot-holds`, JSON.stringify(payload), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      tags: { endpoint: 'slot-hold', step: tagHttp },
    });
    hold_duration.add(res.timings.duration);
    logReq('slot-hold', res);
    assertMax('slot-hold', res.timings.duration, LIMIT_MS.hold);
  });
  return res;
}

function postBooking(headers, payload, tagHttp) {
  let res;
  group('booking', () => {
    res = http.post(`${API_BASE}/appointments/book`, JSON.stringify(payload), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      tags: { endpoint: 'booking', step: tagHttp },
    });
    booking_duration.add(res.timings.duration);
    logReq('booking', res);
    assertMax('booking', res.timings.duration, LIMIT_MS.booking);
  });
  return res;
}

function postCancel(headers, payload, tagHttp) {
  let res;
  group('cancel', () => {
    res = http.post(`${API_BASE}/appointments/cancel`, JSON.stringify(payload), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      tags: { endpoint: 'cancel', step: tagHttp },
    });
    cancel_duration.add(res.timings.duration);
    logReq('cancel', res);
    assertMax('cancel', res.timings.duration, LIMIT_MS.cancel);
  });
  return res;
}

function patchAppointment(headers, id, payload, tagHttp) {
  let res;
  group('reschedule', () => {
    res = http.patch(`${API_BASE}/appointments/${id}`, JSON.stringify(payload), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      tags: { endpoint: 'reschedule', step: tagHttp },
    });
    reschedule_duration.add(res.timings.duration);
    logReq('reschedule', res);
    assertMax('reschedule', res.timings.duration, LIMIT_MS.reschedule);
  });
  return res;
}

export function setup() {
  const token = stripBearer(__ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '');
  if (!token) {
    throw new Error('AUTH_TOKEN required');
  }
  return {
    token,
    businessId: SEED_BUSINESS,
    staffId: SEED_STAFF,
    customerId: SEED_CUSTOMER,
    service15: SEED_SERVICE_15,
    service25: SEED_SERVICE_25,
    service35: SEED_SERVICE_35,
    date: TEST_YMD,
  };
}

export function runCorrectness(data) {
  const headers = { ...authH(data.token), 'Content-Type': 'application/json' };
  const { businessId, staffId, customerId, service15, service25, service35, date } = data;

  console.log(
    JSON.stringify({
      seeded: { businessId: 'seed-business→UUID', staffId: 'seed-staff→UUID' },
      resolved: { businessId, staffId },
      testDate: date,
    }),
  );

  const r0 = getAvailability(
    headers,
    {
      businessId,
      date,
      staffId,
      serviceId: service25,
      compact: 1,
    },
    'main_before',
  );
  if (r0.status === 401) {
    console.error(
      JSON.stringify({
        hint401:
          'Unauthorized: put a fresh access JWT in AUTH_TOKEN (JSON field accessToken from login), not refresh. Same machine: JWT_SECRET in .env must match the running backend. Optional: BASE_URL (default http://localhost:3000).',
      }),
    );
  }
  assert(r0.status === 200, 'availability main_before must be 200', { status: r0.status });
  const rows0 = safeJson(r0);
  const row0 = rowForStaff(rows0, staffId);
  const slots0 = sortSlots(row0 && row0.slots ? row0.slots : []);
  console.log(JSON.stringify({ selectedFlow: 'main', availabilityBefore: slots0.slice(0, 40) }));
  assert(slots0.length >= 5, 'need >=5 slots on seed day', { count: slots0.length });
  const slotA = slots0[0];
  console.log(JSON.stringify({ selectedSlot: slotA }));

  const h1 = postSlotHold(
    headers,
    {
      businessId,
      staffId,
      serviceId: service25,
      customerId,
      date,
      startTime: slotA,
      durationMinutes: 25,
    },
    'first_hold',
  );
  assert(h1.status === 200 || h1.status === 201, 'first hold must be 200/201', {
    status: h1.status,
  });
  const h1b = safeJson(h1);
  const holdId = h1b && h1b.hold && h1b.hold.id ? h1b.hold.id : null;
  assert(holdId, 'hold id missing', {});

  const h2 = postSlotHold(
    headers,
    {
      businessId,
      staffId,
      serviceId: service25,
      customerId,
      date,
      startTime: slotA,
      durationMinutes: 25,
    },
    'duplicate_hold',
  );
  assert(h2.status === 409, 'duplicate hold must be 409', { status: h2.status });

  const b1 = postBooking(headers, { businessId, slotHoldId: holdId }, 'book');
  assert(b1.status === 200 || b1.status === 201, 'book must be 200/201', { status: b1.status });
  const b1b = safeJson(b1);
  const apptId = b1b && b1b.id ? b1b.id : null;
  assert(apptId, 'appointment id missing', {});

  const r1 = getAvailability(
    headers,
    {
      businessId,
      date,
      staffId,
      serviceId: service25,
      compact: 1,
    },
    'after_book',
  );
  assert(r1.status === 200, 'availability after_book 200', { status: r1.status });
  const slots1 = sortSlots((rowForStaff(safeJson(r1), staffId) || {}).slots || []);
  console.log(JSON.stringify({ availabilityAfterBook: slots1.slice(0, 40) }));
  assert(!slots1.includes(slotA), 'booked slot must not appear', { slotA, slots1 });

  const c1 = postCancel(
    headers,
    { appointmentId: apptId, businessId, reason: 'k6 seed lifecycle' },
    'cancel_main',
  );
  assert(c1.status === 200 || c1.status === 201, 'cancel 2xx', { status: c1.status });

  const r2 = getAvailability(
    headers,
    {
      businessId,
      date,
      staffId,
      serviceId: service25,
      compact: 1,
    },
    'after_cancel',
  );
  assert(r2.status === 200, 'availability after_cancel 200', { status: r2.status });
  const slots2 = sortSlots((rowForStaff(safeJson(r2), staffId) || {}).slots || []);
  console.log(JSON.stringify({ availabilityAfterCancel: slots2.slice(0, 40) }));
  assert(slots2.includes(slotA), 'canceled slot must reappear', { slotA });

  const av15 = getAvailability(
    headers,
    { businessId, date, staffId, serviceId: service15, compact: 1 },
    'dur_15',
  );
  const av35 = getAvailability(
    headers,
    { businessId, date, staffId, serviceId: service35, compact: 1 },
    'dur_35',
  );
  assert(av15.status === 200 && av35.status === 200, 'duration compare GET 200', {
    s15: av15.status,
    s35: av35.status,
  });
  const len15 = sortSlots((rowForStaff(safeJson(av15), staffId) || {}).slots || []).length;
  const len35 = sortSlots((rowForStaff(safeJson(av35), staffId) || {}).slots || []).length;
  console.log(JSON.stringify({ serviceDurationSlotCount: { len15, len35 } }));
  assert(len15 > len35, 'shorter service must expose strictly more starts than longer', {
    len15,
    len35,
  });

  const invalidSet = new Set(slots2);
  let invalidSlot = null;
  for (const t of INVALID_SLOT_TRIES) {
    if (!invalidSet.has(t)) {
      invalidSlot = t;
      break;
    }
  }
  assert(invalidSlot, 'could not find synthetic slot outside availability list', {
    INVALID_SLOT_TRIES,
  });
  const hi = postSlotHold(
    headers,
    {
      businessId,
      staffId,
      serviceId: service25,
      customerId,
      date,
      startTime: invalidSlot,
      durationMinutes: 25,
    },
    'invalid_slot',
  );
  assert(
    hi.status === 409 || hi.status === 400 || hi.status === 422,
    'invalid slot hold must fail',
    { status: hi.status },
  );

  const rGrid = getAvailability(
    headers,
    {
      businessId,
      date,
      staffId,
      serviceId: service25,
      compact: 0,
    },
    'reschedule_grid',
  );
  assert(rGrid.status === 200, 'reschedule grid 200', { status: rGrid.status });
  const gridRow = rowForStaff(safeJson(rGrid), staffId);
  const gridSlots = sortSlots(gridRow && gridRow.slots ? gridRow.slots : []);
  const details = gridRow && Array.isArray(gridRow.slotsDetail) ? gridRow.slotsDetail : [];
  assert(gridSlots.length >= 2, 'need 2 slots for reschedule', {});
  const rsA = gridSlots[0];
  const endAMin = hhmmToMin(rsA) + 25;
  const rsB =
    gridSlots.find((s) => s !== rsA && hhmmToMin(s) >= endAMin) || gridSlots[1];
  assert(rsA && rsB && rsA !== rsB, 'two distinct reschedule slots', { rsA, rsB });
  console.log(JSON.stringify({ rescheduleSlots: { old: rsA, new: rsB } }));

  const hR = postSlotHold(
    headers,
    {
      businessId,
      staffId,
      serviceId: service25,
      customerId,
      date,
      startTime: rsA,
      durationMinutes: 25,
    },
    'hold_reschedule',
  );
  assert(hR.status === 200 || hR.status === 201, 'reschedule hold 2xx', {
    status: hR.status,
  });
  const hRb = safeJson(hR);
  const hRid = hRb && hRb.hold && hRb.hold.id ? hRb.hold.id : null;
  const bR = postBooking(headers, { businessId, slotHoldId: hRid }, 'book_reschedule');
  assert(bR.status === 200 || bR.status === 201, 'reschedule book 2xx', {
    status: bR.status,
  });
  const apptR = (safeJson(bR) || {}).id;
  const detB = details.find((d) => d && d.businessTime === rsB);
  assert(detB && detB.startUtc, 'slotsDetail for new slot', { rsB });
  const ns = new Date(detB.startUtc);
  const ne = new Date(ns.getTime() + 25 * 60 * 1000);
  const p1 = patchAppointment(
    headers,
    apptR,
    { businessId, startTime: ns.toISOString(), endTime: ne.toISOString() },
    'reschedule_patch',
  );
  assert(p1.status === 200, 'PATCH reschedule 200', { status: p1.status });

  const rAfter = getAvailability(
    headers,
    { businessId, date, staffId, serviceId: service25, compact: 1 },
    'after_reschedule',
  );
  assert(rAfter.status === 200, 'after reschedule GET 200', { status: rAfter.status });
  const slotsR = sortSlots((rowForStaff(safeJson(rAfter), staffId) || {}).slots || []);
  console.log(JSON.stringify({ availabilityAfterReschedule: slotsR.slice(0, 40) }));
  assert(slotsR.includes(rsA), 'old wall slot free after reschedule', { rsA });
  assert(!slotsR.includes(rsB), 'new wall slot occupied', { rsB });

  const cR = postCancel(
    headers,
    { appointmentId: apptR, businessId, reason: 'k6 reschedule cleanup' },
    'cancel_reschedule',
  );
  assert(cR.status === 200 || cR.status === 201, 'cleanup cancel 2xx', {
    status: cR.status,
  });

  console.log(JSON.stringify({ result: 'PASS', businessId, staffId }));
}

export function runLightAvailabilityHold(data) {
  // constant-vus + exec: in some k6 versions the setup() return value is not passed here;
  // missing query fields → Nest ValidationPipe (forbidNonWhitelisted) → 400 on GET /availability.
  const token = stripBearer(
    (data && data.token) || __ENV.AUTH_TOKEN || __ENV.K6_AUTH_TOKEN || '',
  );
  assert(token, 'light: need token from setup() or AUTH_TOKEN', {});
  const businessId = (data && data.businessId) || SEED_BUSINESS;
  const staffId = (data && data.staffId) || SEED_STAFF;
  const customerId = (data && data.customerId) || SEED_CUSTOMER;
  const service25 = (data && data.service25) || SEED_SERVICE_25;
  const date = (data && data.date) || TEST_YMD;

  const headers = { ...authH(token), 'Content-Type': 'application/json' };

  const avRes = getAvailability(
    headers,
    { businessId, date, staffId, serviceId: service25, compact: 1 },
    'light_av',
  );
  if (avRes.status === 401) {
    console.error(
      JSON.stringify({
        hint401:
          'light scenario: refresh AUTH_TOKEN (access JWT). correctness may still pass if it ran earlier with a token that expired before startTime.',
      }),
    );
  }
  if (avRes.status === 400) {
    console.error(
      JSON.stringify({
        hint400:
          'Bad request on availability — often missing/invalid query vs AvailabilityQueryDto. Resolved:',
        businessId,
        staffId,
        serviceId: service25,
        date,
      }),
    );
  }
  assert(avRes.status === 200, 'light availability 200', { status: avRes.status });

  const row = rowForStaff(safeJson(avRes), staffId);
  const slots = sortSlots(row && row.slots ? row.slots : []);
  if (slots.length === 0) {
    return;
  }
  const idx = (__VU - 1 + __ITER * 11) % slots.length;
  const slot = slots[idx];

  group('hold', () => {
    const h = http.post(
      `${API_BASE}/appointments/slot-holds`,
      JSON.stringify({
        businessId,
        staffId,
        serviceId: service25,
        customerId,
        date,
        startTime: slot,
        durationMinutes: 25,
      }),
      {
        headers,
        tags: { endpoint: 'slot-hold', scenario: 'light', step: 'light_hold' },
      },
    );
    hold_duration.add(h.timings.duration);
    logReq('slot-hold', h);
    assertMax('slot-hold', h.timings.duration, LIMIT_MS.hold);
    assert(h.status === 200 || h.status === 201, 'light hold 2xx', {
      status: h.status,
      slot,
      vu: __VU,
    });
  });
}
