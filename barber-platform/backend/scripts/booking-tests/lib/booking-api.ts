/**
 * Typed wrappers around the booking API for Node test runners.
 * Uses native fetch (Node 18+).
 */

export interface BookingApiOpts {
  baseUrl: string;
  apiPrefix: string;
  authToken: string;
  /** When set, {@link refreshAccessToken} uses this to obtain a fresh access token. */
  refreshToken?: string;
}

/**
 * Call POST /auth/refresh to obtain a new access token.
 * Mutates `opts.authToken` in place on success; returns true.
 * Returns false on failure (caller can keep running with the old token).
 */
export async function refreshAccessToken(opts: BookingApiOpts): Promise<boolean> {
  const rt = opts.refreshToken;
  if (!rt) return false;
  try {
    const res = await fetch(`${opts.baseUrl}/${opts.apiPrefix}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const newAccess = body?.accessToken ?? body?.access_token;
    if (typeof newAccess === 'string' && newAccess.length > 20) {
      opts.authToken = newAccess;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function url(opts: BookingApiOpts, path: string, qs?: Record<string, string | number | boolean>) {
  let u = `${opts.baseUrl}/${opts.apiPrefix}/${path}`;
  if (qs) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (parts.length) u += `?${parts.join('&')}`;
  }
  return u;
}

function headers(opts: BookingApiOpts): Record<string, string> {
  return {
    Authorization: `Bearer ${opts.authToken}`,
    'Content-Type': 'application/json',
  };
}

export async function getAvailability(
  opts: BookingApiOpts,
  params: {
    businessId: string;
    staffId: string;
    serviceId: string;
    date: string;
    days?: number;
    compact?: number;
  },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(
    url(opts, 'availability', {
      businessId: params.businessId,
      staffId: params.staffId,
      serviceId: params.serviceId,
      date: params.date,
      days: params.days ?? 1,
      compact: params.compact ?? 1,
      maxSlotsPerRow: 192,
      chronologicalSlots: true,
    }),
    { headers: headers(opts) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function parseAvailabilitySlots(
  body: unknown,
  staffId: string,
): string[] {
  const rows = Array.isArray(body)
    ? body
    : ((body as Record<string, unknown>)?.results ??
        (body as Record<string, unknown>)?.data ??
        []);
  if (!Array.isArray(rows)) return [];
  const norm = staffId.toLowerCase().replace(/-/g, '');
  const row = rows.find(
    (r: Record<string, unknown>) =>
      String(r.staffId ?? '')
        .toLowerCase()
        .replace(/-/g, '') === norm,
  ) as { slots?: string[] } | undefined;
  return row?.slots ?? [];
}

export interface SlotHoldResult {
  status: number;
  holdId: string | null;
  body: unknown;
}

export async function createSlotHold(
  opts: BookingApiOpts,
  payload: {
    businessId: string;
    staffId: string;
    serviceId: string;
    customerId: string;
    date: string;
    startTime: string;
    durationMinutes: number;
  },
): Promise<SlotHoldResult> {
  const res = await fetch(url(opts, 'appointments/slot-holds'), {
    method: 'POST',
    headers: headers(opts),
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const holdId =
    body && typeof body === 'object' && body.hold
      ? (body.hold as Record<string, unknown>).id as string
      : null;
  return { status: res.status, holdId, body };
}

export interface BookResult {
  status: number;
  appointmentId: string | null;
  body: unknown;
}

export async function bookAppointment(
  opts: BookingApiOpts,
  payload: { businessId: string; slotHoldId: string; idempotencyKey?: string },
): Promise<BookResult> {
  const res = await fetch(url(opts, 'appointments/book'), {
    method: 'POST',
    headers: headers(opts),
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const appointmentId =
    body && typeof body === 'object' ? (body.id as string | undefined) ?? null : null;
  return { status: res.status, appointmentId, body };
}

export async function cancelAppointment(
  opts: BookingApiOpts,
  payload: { appointmentId: string; businessId: string; reason?: string },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url(opts, 'appointments/cancel'), {
    method: 'POST',
    headers: headers(opts),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function rescheduleAppointment(
  opts: BookingApiOpts,
  appointmentId: string,
  payload: { businessId: string; startTime: string; endTime: string },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url(opts, `appointments/${appointmentId}`), {
    method: 'PATCH',
    headers: headers(opts),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export interface Fixture {
  staffId: string;
  serviceIds: string[];
  customerIds: string[];
  blockMinutesByStaffService: Map<string, number>;
  businessTimezone: string;
}

export async function resolveFixture(
  opts: BookingApiOpts,
  businessId: string,
): Promise<Fixture> {
  const staffRes = await fetch(
    url(opts, 'staff', { businessId, limit: 100, page: 1 }),
    { headers: headers(opts) },
  );
  if (!staffRes.ok)
    throw new Error(`GET /staff ${staffRes.status}`);
  const staffList = (await staffRes.json()) as Array<{ id: string }>;
  if (!staffList.length) throw new Error('No staff');
  const staffId = staffList[0].id;

  const svcRes = await fetch(url(opts, 'services', { businessId }), {
    headers: headers(opts),
  });
  if (!svcRes.ok)
    throw new Error(`GET /services ${svcRes.status}`);
  const svcList = (await svcRes.json()) as Array<{
    id: string;
    durationMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    staffServices?: Array<{
      staffId: string;
      durationMinutes?: number;
      allowBooking?: boolean;
    }>;
  }>;

  const blockMap = new Map<string, number>();
  const serviceIds: string[] = [];
  const sNorm = staffId.toLowerCase().replace(/-/g, '');
  for (const s of svcList) {
    for (const ss of s.staffServices ?? []) {
      if (
        ss.staffId?.toLowerCase().replace(/-/g, '') !== sNorm ||
        ss.allowBooking === false
      )
        continue;
      serviceIds.push(s.id);
      const dur =
        (ss.durationMinutes && ss.durationMinutes > 0
          ? ss.durationMinutes
          : s.durationMinutes) || 30;
      const block = dur + (s.bufferBeforeMinutes ?? 0) + (s.bufferAfterMinutes ?? 0);
      blockMap.set(
        `${sNorm}|${s.id.toLowerCase().replace(/-/g, '')}`,
        Math.max(1, Math.floor(block)),
      );
      break;
    }
  }
  if (!serviceIds.length) throw new Error('No bookable services for staff');

  const custRes = await fetch(url(opts, 'customers', { businessId }), {
    headers: headers(opts),
  });
  if (!custRes.ok)
    throw new Error(`GET /customers ${custRes.status}`);
  const custList = (await custRes.json()) as Array<{ id: string }>;
  if (!custList.length) throw new Error('No customers');

  const avRes = await fetch(
    url(opts, 'availability', {
      businessId,
      staffId,
      serviceId: serviceIds[0],
      date: new Date().toISOString().slice(0, 10),
      days: 1,
      compact: 1,
      maxSlotsPerRow: 4,
      chronologicalSlots: true,
    }),
    { headers: headers(opts) },
  );
  let tz = 'Asia/Jerusalem';
  if (avRes.ok) {
    const avBody = (await avRes.json()) as unknown;
    const rows = Array.isArray(avBody) ? avBody : [];
    if (rows[0]?.businessTimezone) tz = rows[0].businessTimezone;
  }

  return {
    staffId,
    serviceIds: [...new Set(serviceIds)],
    customerIds: custList.map((c) => c.id),
    blockMinutesByStaffService: blockMap,
    businessTimezone: tz,
  };
}

export function blockMinutesFor(
  fixture: Fixture,
  staffId: string,
  serviceId: string,
  fallback = 45,
): number {
  const key = `${staffId.toLowerCase().replace(/-/g, '')}|${serviceId
    .toLowerCase()
    .replace(/-/g, '')}`;
  return fixture.blockMinutesByStaffService.get(key) ?? fallback;
}

/**
 * Scans forward up to maxDays from today for a date with >= minSlots free slots.
 */
export async function findDateWithSlots(
  opts: BookingApiOpts,
  businessId: string,
  staffId: string,
  serviceId: string,
  minSlots: number,
  maxDays = 28,
): Promise<{ dateYmd: string; slots: string[] } | null> {
  for (let off = 0; off <= maxDays; off++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + off);
    const ymd = d.toISOString().slice(0, 10);
    const av = await getAvailability(opts, {
      businessId,
      staffId,
      serviceId,
      date: ymd,
    });
    if (av.status !== 200) continue;
    const slots = parseAvailabilitySlots(av.body, staffId);
    if (slots.length >= minSlots) {
      return { dateYmd: ymd, slots: slots.sort() };
    }
  }
  return null;
}
