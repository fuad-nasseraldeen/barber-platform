import { PrismaClient, Prisma, AppointmentStatus } from '@prisma/client';
import { formatBusinessTime, toUtcFromBusinessHhmm } from '../src/common/time-engine';

type DbClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const prisma = new PrismaClient();

const businessId = 'a0000001-0000-4000-8000-000000000001';
const branchId = 'a0000001-0000-4000-8000-000000000002';

const serviceId15 = 'a0000001-0000-4000-8000-000000000015';
const serviceId25 = 'a0000001-0000-4000-8000-000000000025';
const serviceId35 = 'a0000001-0000-4000-8000-000000000035';

/** First appointment day (UTC calendar); 10 consecutive days × 20 staff = 200 appointments */
const APPOINTMENT_ANCHOR_YMD = '2026-04-07';

const OVERRIDE_SAT = '2026-04-11';

const NUM_STAFF = 20;
const NUM_CUSTOMERS = 50;
const NUM_APPOINTMENT_DAYS = 10;

/** Align with typical deployed barbershops (k6 + availability use business TZ). */
const TZ = 'Asia/Jerusalem';

const SEED_OWNER_EMAIL = 'fuadsami5@gmail.com';

/** Align with k6/booking-seed-lifecycle.test.js */
const LEGACY_FIRST_STAFF_ID = 'a0000001-0000-4000-8000-000000000003';
const LEGACY_FIRST_CUSTOMER_ID = 'a0000001-0000-4000-8000-000000000004';

function d(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Same rule as {@link BookingService.confirmBookingFromHold} — never raw `${ymd}:${hhmm}Z` for keys. */
function appointmentSlotKey(staffId: string, startUtc: Date): string {
  const ymd = formatBusinessTime(startUtc, TZ, 'yyyy-MM-dd');
  const wall = formatBusinessTime(startUtc, TZ, 'HH:mm');
  return `${businessId}:${staffId}:${ymd}:${wall}`;
}

/** Deterministic UUIDs for k6 / debugging (suffix 12 hex digits) */
function u64(segment: bigint, index: number): string {
  const tail = (segment + BigInt(index)).toString(16).padStart(12, '0').slice(-12);
  return `a0000001-0000-4000-8000-${tail}`;
}

const SEG_STAFF = 0x0010_0000n;
const SEG_CUSTOMER = 0x0020_0000n;
const SEG_APPOINTMENT = 0x0030_0000n;
const SEG_STAFF_SERVICE = 0x0050_0000n;
const SEG_BREAK_EX = 0x0060_0000n;
const SEG_TIME_OFF = 0x0070_0000n;

function staffUuid(i: number) {
  return u64(SEG_STAFF, i);
}
function customerUuid(i: number) {
  return u64(SEG_CUSTOMER, i);
}

function staffIdForIndex(i: number) {
  return i === 0 ? LEGACY_FIRST_STAFF_ID : staffUuid(i);
}
function customerIdForIndex(c: number) {
  return c === 0 ? LEGACY_FIRST_CUSTOMER_ID : customerUuid(c);
}
function appointmentUuid(i: number) {
  return u64(SEG_APPOINTMENT, i);
}
function staffServiceUuid(staffIndex: number, svcSlot: number) {
  return u64(SEG_STAFF_SERVICE, staffIndex * 32 + svcSlot);
}

function addDaysYmd(ymd: string, delta: number): string {
  const t = new Date(`${ymd}T12:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

async function purgePriorOwnedBusinessesExceptSeed(tx: DbClient) {
  const u = await tx.user.findFirst({
    where: { email: SEED_OWNER_EMAIL, deletedAt: null },
  });
  if (!u) return;

  const memberships = await tx.businessUser.findMany({
    where: { userId: u.id, isActive: true },
    include: { role: true },
  });

  const toRemove = new Set<string>();
  for (const m of memberships) {
    if (m.businessId === businessId) continue;
    const slug = (m.role.slug || '').toLowerCase();
    if (slug === 'owner') {
      toRemove.add(m.businessId);
    }
  }

  for (const bid of toRemove) {
    const row = await tx.business.findFirst({
      where: { id: bid, deletedAt: null },
    });
    if (row) {
      await tx.business.delete({ where: { id: bid } });
      console.log(JSON.stringify({ purgedOwnedBusiness: bid, name: row.name }));
    }
  }
}

async function wipeSeedBusinessData(tx: DbClient, bid: string) {
  await tx.bookingIdempotency.deleteMany({ where: { businessId: bid } });
  await tx.appointmentSlot.deleteMany({ where: { businessId: bid } });
  await tx.availabilitySlot.deleteMany({ where: { businessId: bid } });
  await tx.appointment.deleteMany({ where: { businessId: bid } });
  await tx.slotHold.deleteMany({ where: { businessId: bid } });
  await tx.waitlist.deleteMany({ where: { businessId: bid } });
  await tx.dailyStaffStats.deleteMany({ where: { businessId: bid } });
  await tx.payment.deleteMany({ where: { businessId: bid } });
  await tx.businessHoliday.deleteMany({ where: { businessId: bid } });

  const svcRows = await tx.service.findMany({
    where: { businessId: bid },
    select: { id: true },
  });
  const svcIds = svcRows.map((s) => s.id);
  if (svcIds.length) {
    await tx.serviceStaffBlock.deleteMany({ where: { serviceId: { in: svcIds } } });
  }

  const staffRows = await tx.staff.findMany({
    where: { businessId: bid },
    select: { id: true },
  });
  const staffIdList = staffRows.map((s) => s.id);
  if (staffIdList.length) {
    await tx.staffAvailabilityCache.deleteMany({
      where: { staffId: { in: staffIdList } },
    });
    await tx.staffBreakException.deleteMany({
      where: { staffId: { in: staffIdList } },
    });
    await tx.staffBreak.deleteMany({ where: { staffId: { in: staffIdList } } });
    await tx.staffWorkingHoursDateOverride.deleteMany({
      where: { staffId: { in: staffIdList } },
    });
    await tx.staffWorkingHours.deleteMany({ where: { staffId: { in: staffIdList } } });
    await tx.staffTimeOff.deleteMany({ where: { staffId: { in: staffIdList } } });
    await tx.staffService.deleteMany({ where: { staffId: { in: staffIdList } } });
  }

  await tx.customer.deleteMany({ where: { businessId: bid } });
  await tx.staff.deleteMany({ where: { businessId: bid } });
  await tx.service.deleteMany({ where: { businessId: bid } });
}

const SEED_PERMISSIONS: Array<{ resource: string; action: string; slug: string }> = [
  { resource: 'business', action: 'read', slug: 'business:read' },
  { resource: 'business', action: 'manage', slug: 'business:manage' },
  { resource: 'business', action: 'write', slug: 'business:write' },
  { resource: 'staff', action: 'read', slug: 'staff:read' },
  { resource: 'staff', action: 'create', slug: 'staff:create' },
  { resource: 'staff', action: 'update', slug: 'staff:update' },
  { resource: 'staff', action: 'delete', slug: 'staff:delete' },
  { resource: 'staff', action: 'manage', slug: 'staff:manage' },
  { resource: 'user', action: 'manage', slug: 'user:manage' },
  { resource: 'analytics', action: 'read', slug: 'analytics:read' },
  { resource: 'waitlist', action: 'read', slug: 'waitlist:read' },
  { resource: 'waitlist', action: 'create', slug: 'waitlist:create' },
  { resource: 'waitlist', action: 'update', slug: 'waitlist:update' },
  { resource: 'waitlist', action: 'manage', slug: 'waitlist:manage' },
  { resource: 'appointment', action: 'read', slug: 'appointment:read' },
  { resource: 'appointment', action: 'create', slug: 'appointment:create' },
  { resource: 'appointment', action: 'update', slug: 'appointment:update' },
  { resource: 'appointment', action: 'delete', slug: 'appointment:delete' },
  { resource: 'payment', action: 'read', slug: 'payment:read' },
  { resource: 'payment', action: 'create', slug: 'payment:create' },
  { resource: 'location', action: 'manage', slug: 'location:manage' },
  { resource: 'location', action: 'create', slug: 'location:create' },
  { resource: 'location', action: 'update', slug: 'location:update' },
  { resource: 'location', action: 'delete', slug: 'location:delete' },
  { resource: 'service', action: 'read', slug: 'service:read' },
  { resource: 'service', action: 'create', slug: 'service:create' },
  { resource: 'service', action: 'update', slug: 'service:update' },
  { resource: 'service', action: 'delete', slug: 'service:delete' },
  { resource: 'service', action: 'manage', slug: 'service:manage' },
  { resource: 'customer', action: 'manage', slug: 'customer:manage' },
  { resource: 'customer', action: 'create', slug: 'customer:create' },
  { resource: 'customer', action: 'update', slug: 'customer:update' },
  { resource: 'customer', action: 'delete', slug: 'customer:delete' },
];

async function ensurePermissions(tx: DbClient): Promise<void> {
  const existing = await tx.permission.count();
  if (existing >= SEED_PERMISSIONS.length) return;
  await tx.permission.createMany({
    data: SEED_PERMISSIONS,
    skipDuplicates: true,
  });
}

async function resolveOwnerRoleId(tx: DbClient): Promise<string> {
  await ensurePermissions(tx);

  let role = await tx.role.findFirst({
    where: { slug: 'owner', businessId: null, isSystem: true },
  });
  if (!role) {
    role = await tx.role.create({
      data: {
        name: 'Owner',
        slug: 'owner',
        businessId: null,
        isSystem: true,
      },
    });
  }
  const rpCount = await tx.rolePermission.count({ where: { roleId: role.id } });
  if (rpCount === 0) {
    const perms = await tx.permission.findMany({ select: { id: true } });
    if (perms.length === 0) {
      throw new Error(
        'DB has no permissions rows — ensurePermissions should have seeded them.',
      );
    }
    await tx.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  return role.id;
}

async function ensureSeedBusinessOwner(tx: DbClient) {
  const roleId = await resolveOwnerRoleId(tx);
  const ownerUser = await tx.user.upsert({
    where: { email: SEED_OWNER_EMAIL },
    create: {
      email: SEED_OWNER_EMAIL,
      firstName: 'פואד',
      lastName: 'מנהל',
      authProvider: 'google',
      emailVerified: true,
    },
    update: {
      firstName: 'פואד',
      lastName: 'מנהל',
      emailVerified: true,
    },
  });
  await tx.businessUser.upsert({
    where: {
      businessId_userId: { businessId, userId: ownerUser.id },
    },
    create: {
      businessId,
      userId: ownerUser.id,
      roleId,
      isActive: true,
    },
    update: {
      roleId,
      isActive: true,
    },
  });
}

function serviceDurationForIndex(i: number): string {
  const ids = [serviceId15, serviceId25, serviceId35];
  return ids[i % 3]!;
}

function minutesForServiceId(sid: string): number {
  if (sid === serviceId15) return 15;
  if (sid === serviceId25) return 25;
  if (sid === serviceId35) return 35;
  return 25;
}

function wallEndFromStart(startHhmm: string, durationMinutes: number): string {
  const [h, m] = startHhmm.split(':').map((x) => parseInt(x, 10));
  const startMin = h * 60 + m;
  const endMin = startMin + durationMinutes;
  const eh = Math.floor(endMin / 60);
  const em = endMin % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

/** Staff 1–5: evening; staff 0 (legacy / k6 primary) stays daytime */
function defaultStartHhmmForStaff(staffIndex: number): string {
  if (staffIndex >= 1 && staffIndex <= 5) {
    return '18:00';
  }
  return '09:00';
}

async function seedBody(tx: DbClient) {
  await purgePriorOwnedBusinessesExceptSeed(tx);
  await wipeSeedBusinessData(tx, businessId);

  await tx.business.upsert({
    where: { id: businessId },
    create: {
      id: businessId,
      name: 'Seed Booking Lab',
      slug: 'seed-booking-lab-a0000001',
      timezone: TZ,
      locale: 'he',
      currency: 'ILS',
      isActive: true,
    },
    update: { name: 'Seed Booking Lab', timezone: TZ },
  });

  await tx.branch.upsert({
    where: { id: branchId },
    create: {
      id: branchId,
      businessId,
      name: 'Main',
    },
    update: {},
  });

  await ensureSeedBusinessOwner(tx);

  const serviceDefs = [
    {
      id: serviceId15,
      name: 'Child Haircut',
      slug: 'child-haircut',
      durationMinutes: 15,
      price: new Prisma.Decimal('70'),
      sortOrder: 1,
    },
    {
      id: serviceId25,
      name: 'Haircut',
      slug: 'haircut',
      durationMinutes: 25,
      price: new Prisma.Decimal('100'),
      sortOrder: 2,
    },
    {
      id: serviceId35,
      name: 'Haircut + Beard',
      slug: 'haircut-beard',
      durationMinutes: 35,
      price: new Prisma.Decimal('130'),
      sortOrder: 3,
    },
  ] as const;

  for (const s of serviceDefs) {
    await tx.service.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        businessId,
        branchId,
        name: s.name,
        slug: s.slug,
        durationMinutes: s.durationMinutes,
        price: s.price,
        currency: 'ILS',
        isActive: true,
        sortOrder: s.sortOrder,
      },
      update: {
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: s.price,
        branchId,
        isActive: true,
        sortOrder: s.sortOrder,
      },
    });
  }

  for (let c = 0; c < NUM_CUSTOMERS; c++) {
    const id = customerIdForIndex(c);
    await tx.customer.create({
      data: {
        id,
        businessId,
        branchId,
        email: `seed.customer.${c + 1}@test.local`,
        firstName: 'לקוח',
        lastName: `מספר ${c + 1}`,
        isActive: true,
      },
    });
  }

  const staffIds: string[] = [];
  for (let i = 0; i < NUM_STAFF; i++) {
    const id = staffIdForIndex(i);
    staffIds.push(id);
    await tx.staff.create({
      data: {
        id,
        businessId,
        branchId,
        firstName: i >= 1 && i <= 5 ? 'לילה' : 'ספר',
        lastName: `מספר ${i + 1}`,
        isActive: true,
      },
    });

    const svcTrip = [
      { sid: serviceId15, slot: 0, dm: 15, p: '70' },
      { sid: serviceId25, slot: 1, dm: 25, p: '100' },
      { sid: serviceId35, slot: 2, dm: 35, p: '130' },
    ] as const;
    for (const row of svcTrip) {
      await tx.staffService.create({
        data: {
          id: staffServiceUuid(i, row.slot),
          staffId: id,
          serviceId: row.sid,
          durationMinutes: row.dm,
          price: new Prisma.Decimal(row.p),
          allowBooking: true,
          sortOrder: row.slot + 1,
        },
      });
    }

    const wh: Prisma.StaffWorkingHoursCreateManyInput[] = [];
    if (i === 0) {
      for (let dow = 0; dow <= 4; dow++) {
        wh.push({
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: '09:00',
          endTime: '18:00',
        });
      }
      wh.push({
        staffId: id,
        branchId,
        dayOfWeek: 5,
        startTime: '09:00',
        endTime: '16:00',
      });
      wh.push({
        staffId: id,
        branchId,
        dayOfWeek: 6,
        startTime: '10:00',
        endTime: '15:00',
      });
    } else if (i >= 1 && i <= 5) {
      for (let dow = 0; dow <= 4; dow++) {
        wh.push({
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: '17:00',
          endTime: '23:00',
        });
      }
      wh.push({
        staffId: id,
        branchId,
        dayOfWeek: 5,
        startTime: '17:00',
        endTime: '21:00',
      });
    } else if (i < 12) {
      for (let dow = 0; dow <= 4; dow++) {
        wh.push({
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: '09:00',
          endTime: '18:00',
        });
      }
      wh.push({
        staffId: id,
        branchId,
        dayOfWeek: 5,
        startTime: '09:00',
        endTime: '16:00',
      });
      wh.push({
        staffId: id,
        branchId,
        dayOfWeek: 6,
        startTime: '10:00',
        endTime: '15:00',
      });
    } else {
      for (let dow = 0; dow <= 6; dow++) {
        if (dow === 3 && i >= 15) {
          continue;
        }
        wh.push({
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: dow === 6 ? '09:00' : '08:00',
          endTime: dow === 6 ? '14:00' : '20:00',
        });
      }
    }
    await tx.staffWorkingHours.createMany({ data: wh });

    const br: Prisma.StaffBreakCreateManyInput[] = [];
    for (let dow = 0; dow <= 6; dow++) {
      if (i >= 1 && i <= 5 && dow === 6) continue;
      if (i >= 15 && dow === 3) continue;
      br.push(
        {
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: '12:00',
          endTime: '12:30',
        },
        {
          staffId: id,
          branchId,
          dayOfWeek: dow,
          startTime: '15:00',
          endTime: '15:15',
        },
      );
    }
    if (br.length) await tx.staffBreak.createMany({ data: br });

    if (i === 5) {
      await tx.staffWorkingHoursDateOverride.create({
        data: {
          staffId: id,
          date: d(addDaysYmd(APPOINTMENT_ANCHOR_YMD, -1)),
          isClosed: true,
        },
      });
    }

    if (i === 7) {
      await tx.staffBreakException.create({
        data: {
          id: u64(SEG_BREAK_EX, i),
          staffId: id,
          branchId,
          date: d(addDaysYmd(APPOINTMENT_ANCHOR_YMD, 2)),
          startTime: '11:00',
          endTime: '12:30',
          kind: 'TIME_BLOCK',
        },
      });
    }

    if (i === 0) {
      await tx.staffTimeOff.create({
        data: {
          id: u64(SEG_TIME_OFF, 0),
          staffId: id,
          branchId,
          startDate: d('2026-05-10'),
          endDate: d('2026-05-12'),
          status: 'APPROVED',
          reason: 'vacation',
        },
      });
    }
    if (i === 1) {
      await tx.staffTimeOff.create({
        data: {
          id: u64(SEG_TIME_OFF, 1),
          staffId: id,
          branchId,
          startDate: d('2026-05-05'),
          endDate: d('2026-05-06'),
          startTime: '14:00',
          endTime: '18:00',
          isAllDay: false,
          status: 'APPROVED',
          reason: 'personal',
        },
      });
    }
  }

  await tx.staffWorkingHoursDateOverride.create({
    data: {
      staffId: staffIds[5]!,
      date: d(OVERRIDE_SAT),
      isClosed: false,
      startTime: '10:00',
      endTime: '16:00',
    },
  });

  await tx.businessHoliday.create({
    data: {
      businessId,
      date: d('2026-12-25'),
      name: 'Holiday seed',
    },
  });

  await tx.staffBreakException.create({
    data: {
      id: u64(SEG_BREAK_EX, 900),
      staffId: staffIds[10]!,
      branchId,
      date: d(addDaysYmd(APPOINTMENT_ANCHOR_YMD, 0)),
      startTime: '15:00',
      endTime: '15:25',
      kind: 'TIME_BLOCK',
    },
  });

  const appts: Prisma.AppointmentCreateManyInput[] = [];
  let api = 0;
  for (let dayIdx = 0; dayIdx < NUM_APPOINTMENT_DAYS; dayIdx++) {
    const ymd = addDaysYmd(APPOINTMENT_ANCHOR_YMD, dayIdx);
    for (let si = 0; si < NUM_STAFF; si++) {
      const sid = staffIds[si]!;
      const cust = customerIdForIndex(api % NUM_CUSTOMERS);
      const svc = serviceDurationForIndex(api);
      const dm = minutesForServiceId(svc);
      const startHhmm = defaultStartHhmmForStaff(si);
      const endHhmm = wallEndFromStart(startHhmm, dm);
      const startTime = toUtcFromBusinessHhmm(ymd, startHhmm, TZ);
      const endTime = toUtcFromBusinessHhmm(ymd, endHhmm, TZ);
      /**
       * `startHhmm` is wall time in `TZ`; persist UTC instants and slotKey exactly like live booking.
       * Old seed used `new Date(ymd + 'T' + hhmm + 'Z')` so slotKey ...:09:00 collided with a real 09:00-local hold.
       */
      appts.push({
        id: appointmentUuid(api),
        businessId,
        branchId,
        customerId: cust,
        staffId: sid,
        serviceId: svc,
        startTime,
        endTime,
        status: AppointmentStatus.CONFIRMED,
        slotKey: appointmentSlotKey(sid, startTime),
      });
      api++;
    }
  }

  if (appts.length !== NUM_STAFF * NUM_APPOINTMENT_DAYS) {
    throw new Error(`appointment count mismatch ${appts.length}`);
  }

  await tx.appointment.createMany({ data: appts });
}

async function main() {
  const t0 = Date.now();

  await prisma.$transaction(seedBody, {
    maxWait: 60_000,
    timeout: 300_000,
  });

  const ms = Date.now() - t0;
  if (ms > 5000) {
    console.warn(`seed completed in ${ms}ms`);
  }

  console.log(
    JSON.stringify({
      businessId,
      branchId,
      staffCount: NUM_STAFF,
      primaryStaffId: LEGACY_FIRST_STAFF_ID,
      customerCount: NUM_CUSTOMERS,
      appointments: NUM_STAFF * NUM_APPOINTMENT_DAYS,
      appointmentAnchor: APPOINTMENT_ANCHOR_YMD,
      serviceIds: [serviceId15, serviceId25, serviceId35],
      seedOwnerEmail: SEED_OWNER_EMAIL,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
