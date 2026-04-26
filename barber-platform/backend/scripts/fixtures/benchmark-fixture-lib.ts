import { AppointmentStatus, Prisma, PrismaClient } from '@prisma/client';
import { formatBusinessTime, toUtcFromBusinessHhmm } from '../../src/common/time-engine';

export const BENCHMARK_FIXTURE = {
  timezone: 'Asia/Jerusalem',
  businessId: 'a0000001-0000-4000-8000-000000000001',
  businessSlug: 'benchmark-booking-lab-a0000001',
  branchId: 'a0000001-0000-4000-8000-000000000002',
  ownerEmail: 'fuad.fareed2@gmail.com',
  services: [
    {
      id: 'a0000001-0000-4000-8000-000000000101',
      name: 'Haircut Standard',
      slug: 'haircut-standard',
      durationMinutes: 25,
      price: new Prisma.Decimal('90'),
    },
    {
      id: 'a0000001-0000-4000-8000-000000000102',
      name: 'Haircut + Beard',
      slug: 'haircut-beard',
      durationMinutes: 45,
      price: new Prisma.Decimal('130'),
    },
  ] as const,
  staff: [
    { id: 'a0000001-0000-4000-8000-000000000201', firstName: 'Benchmark', lastName: 'Staff 1' },
    { id: 'a0000001-0000-4000-8000-000000000202', firstName: 'Benchmark', lastName: 'Staff 2' },
    { id: 'a0000001-0000-4000-8000-000000000203', firstName: 'Benchmark', lastName: 'Staff 3' },
  ] as const,
  customers: [
    {
      id: 'a0000001-0000-4000-8000-000000000301',
      email: 'benchmark.customer.1@test.local',
      firstName: 'Benchmark',
      lastName: 'Customer 1',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000302',
      email: 'benchmark.customer.2@test.local',
      firstName: 'Benchmark',
      lastName: 'Customer 2',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000303',
      email: 'benchmark.customer.3@test.local',
      firstName: 'Benchmark',
      lastName: 'Customer 3',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000304',
      email: 'benchmark.customer.4@test.local',
      firstName: 'Benchmark',
      lastName: 'Customer 4',
    },
  ] as const,
  appointments: [
    {
      id: 'a0000001-0000-4000-8000-000000000401',
      staffId: 'a0000001-0000-4000-8000-000000000201',
      customerId: 'a0000001-0000-4000-8000-000000000301',
      serviceId: 'a0000001-0000-4000-8000-000000000101',
      date: '2026-04-20',
      startTime: '09:30',
      endTime: '09:55',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000402',
      staffId: 'a0000001-0000-4000-8000-000000000201',
      customerId: 'a0000001-0000-4000-8000-000000000302',
      serviceId: 'a0000001-0000-4000-8000-000000000102',
      date: '2026-04-20',
      startTime: '14:00',
      endTime: '14:45',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000403',
      staffId: 'a0000001-0000-4000-8000-000000000202',
      customerId: 'a0000001-0000-4000-8000-000000000303',
      serviceId: 'a0000001-0000-4000-8000-000000000101',
      date: '2026-04-21',
      startTime: '10:00',
      endTime: '10:25',
    },
    {
      id: 'a0000001-0000-4000-8000-000000000404',
      staffId: 'a0000001-0000-4000-8000-000000000203',
      customerId: 'a0000001-0000-4000-8000-000000000304',
      serviceId: 'a0000001-0000-4000-8000-000000000102',
      date: '2026-04-21',
      startTime: '16:00',
      endTime: '16:45',
    },
  ] as const,
};

const OWNER_ROLE_PERMISSION_BASELINE: Array<{ resource: string; action: string; slug: string }> = [
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

function d(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function appointmentSlotKey(staffId: string, startUtc: Date): string {
  const ymd = formatBusinessTime(startUtc, BENCHMARK_FIXTURE.timezone, 'yyyy-MM-dd');
  const wall = formatBusinessTime(startUtc, BENCHMARK_FIXTURE.timezone, 'HH:mm');
  return `${BENCHMARK_FIXTURE.businessId}:${staffId}:${ymd}:${wall}`;
}

async function ensureOwnerRoleId(tx: Prisma.TransactionClient): Promise<string> {
  await tx.permission.createMany({
    data: OWNER_ROLE_PERMISSION_BASELINE,
    skipDuplicates: true,
  });

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

  const rolePermissionCount = await tx.rolePermission.count({
    where: { roleId: role.id },
  });
  if (rolePermissionCount === 0) {
    const permissions = await tx.permission.findMany({ select: { id: true } });
    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  return role.id;
}

export async function resetBenchmarkFixture(tx: Prisma.TransactionClient): Promise<void> {
  const businessId = BENCHMARK_FIXTURE.businessId;

  await tx.bookingProjectionOutbox.deleteMany({ where: { businessId } });
  await tx.bookingIdempotency.deleteMany({ where: { businessId } });
  await tx.appointmentSlot.deleteMany({ where: { businessId } });
  await tx.availabilitySlot.deleteMany({ where: { businessId } });
  await tx.waitlist.deleteMany({ where: { businessId } });
  await tx.dailyStaffStats.deleteMany({ where: { businessId } });
  await tx.dailyServiceStats.deleteMany({ where: { businessId } });
  await tx.dailyBusinessStats.deleteMany({ where: { businessId } });
  await tx.payment.deleteMany({ where: { businessId } });
  await tx.businessHoliday.deleteMany({ where: { businessId } });
  await tx.notification.deleteMany({ where: { businessId } });
  await tx.auditLog.deleteMany({ where: { businessId } });
  await tx.subscription.deleteMany({ where: { businessId } });
  await tx.timeSlot.deleteMany({ where: { businessId } });
  await tx.customerVisit.deleteMany({ where: { businessId } });
  await tx.appointment.deleteMany({ where: { businessId } });
  await tx.slotHold.deleteMany({ where: { businessId } });

  const serviceRows = await tx.service.findMany({
    where: { businessId },
    select: { id: true },
  });
  const serviceIds = serviceRows.map((row) => row.id);
  if (serviceIds.length > 0) {
    await tx.serviceStaffBlock.deleteMany({
      where: { serviceId: { in: serviceIds } },
    });
  }

  const staffRows = await tx.staff.findMany({
    where: { businessId },
    select: { id: true },
  });
  const staffIds = staffRows.map((row) => row.id);
  if (staffIds.length > 0) {
    await tx.staffAvailabilityCache.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffBreakException.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffBreak.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffWorkingHoursDateOverride.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffWorkingHours.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffTimeOff.deleteMany({ where: { staffId: { in: staffIds } } });
    await tx.staffService.deleteMany({ where: { staffId: { in: staffIds } } });
  }

  await tx.customer.deleteMany({ where: { businessId } });
  await tx.staff.deleteMany({ where: { businessId } });
  await tx.service.deleteMany({ where: { businessId } });
  await tx.serviceCategory.deleteMany({ where: { businessId } });
  await tx.location.deleteMany({ where: { businessId } });
  await tx.staffInvite.deleteMany({ where: { businessId } });
  await tx.businessInvite.deleteMany({ where: { businessId } });
  await tx.businessUser.deleteMany({ where: { businessId } });
  await tx.role.deleteMany({ where: { businessId } });
  await tx.branch.deleteMany({ where: { businessId } });
  await tx.business.deleteMany({ where: { id: businessId } });
}

export async function seedBenchmarkFixture(tx: Prisma.TransactionClient): Promise<void> {
  await tx.business.create({
    data: {
      id: BENCHMARK_FIXTURE.businessId,
      name: 'Benchmark Booking Lab',
      slug: BENCHMARK_FIXTURE.businessSlug,
      timezone: BENCHMARK_FIXTURE.timezone,
      locale: 'he',
      currency: 'ILS',
      isActive: true,
    },
  });

  await tx.branch.create({
    data: {
      id: BENCHMARK_FIXTURE.branchId,
      businessId: BENCHMARK_FIXTURE.businessId,
      name: 'Main Branch',
    },
  });

  const ownerRoleId = await ensureOwnerRoleId(tx);
  const ownerUser = await tx.user.upsert({
    where: { email: BENCHMARK_FIXTURE.ownerEmail },
    create: {
      email: BENCHMARK_FIXTURE.ownerEmail,
      firstName: 'Fuad',
      lastName: 'Fareed',
      authProvider: 'google',
      emailVerified: true,
    },
    update: {
      firstName: 'Fuad',
      lastName: 'Fareed',
      authProvider: 'google',
      emailVerified: true,
      isActive: true,
      deletedAt: null,
    },
  });

  await tx.businessUser.create({
    data: {
      businessId: BENCHMARK_FIXTURE.businessId,
      userId: ownerUser.id,
      roleId: ownerRoleId,
      isActive: true,
    },
  });

  await tx.service.createMany({
    data: BENCHMARK_FIXTURE.services.map((service, index) => ({
      id: service.id,
      businessId: BENCHMARK_FIXTURE.businessId,
      branchId: BENCHMARK_FIXTURE.branchId,
      name: service.name,
      slug: service.slug,
      durationMinutes: service.durationMinutes,
      price: service.price,
      currency: 'ILS',
      isActive: true,
      sortOrder: index + 1,
    })),
  });

  await tx.staff.createMany({
    data: BENCHMARK_FIXTURE.staff.map((staff) => ({
      id: staff.id,
      businessId: BENCHMARK_FIXTURE.businessId,
      branchId: BENCHMARK_FIXTURE.branchId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      isActive: true,
    })),
  });

  await tx.customer.createMany({
    data: BENCHMARK_FIXTURE.customers.map((customer) => ({
      id: customer.id,
      businessId: BENCHMARK_FIXTURE.businessId,
      branchId: BENCHMARK_FIXTURE.branchId,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      isActive: true,
    })),
  });

  const staffServiceRows: Prisma.StaffServiceCreateManyInput[] = [];
  BENCHMARK_FIXTURE.staff.forEach((staff, staffIndex) => {
    BENCHMARK_FIXTURE.services.forEach((service, serviceIndex) => {
      staffServiceRows.push({
        id: `a0000001-0000-4000-8000-0000000005${String(staffIndex * 10 + serviceIndex + 1).padStart(2, '0')}`,
        staffId: staff.id,
        serviceId: service.id,
        durationMinutes: service.durationMinutes,
        price: service.price,
        allowBooking: true,
        sortOrder: serviceIndex + 1,
      });
    });
  });
  await tx.staffService.createMany({ data: staffServiceRows });

  const workingHourRows: Prisma.StaffWorkingHoursCreateManyInput[] = [];
  const breakRows: Prisma.StaffBreakCreateManyInput[] = [];
  for (const staff of BENCHMARK_FIXTURE.staff) {
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      workingHourRows.push({
        staffId: staff.id,
        branchId: BENCHMARK_FIXTURE.branchId,
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      });
      breakRows.push({
        staffId: staff.id,
        branchId: BENCHMARK_FIXTURE.branchId,
        dayOfWeek,
        startTime: '13:00',
        endTime: '13:30',
      });
    }
  }
  await tx.staffWorkingHours.createMany({ data: workingHourRows });
  await tx.staffBreak.createMany({ data: breakRows });

  const appointmentRows: Prisma.AppointmentCreateManyInput[] =
    BENCHMARK_FIXTURE.appointments.map((appointment) => {
      const startUtc = toUtcFromBusinessHhmm(
        appointment.date,
        appointment.startTime,
        BENCHMARK_FIXTURE.timezone,
      );
      const endUtc = toUtcFromBusinessHhmm(
        appointment.date,
        appointment.endTime,
        BENCHMARK_FIXTURE.timezone,
      );
      return {
        id: appointment.id,
        businessId: BENCHMARK_FIXTURE.businessId,
        branchId: BENCHMARK_FIXTURE.branchId,
        customerId: appointment.customerId,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
        startTime: startUtc,
        endTime: endUtc,
        status: AppointmentStatus.CONFIRMED,
        slotKey: appointmentSlotKey(appointment.staffId, startUtc),
      };
    });

  await tx.appointment.createMany({ data: appointmentRows });
}

export async function reseedBenchmarkFixture(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await resetBenchmarkFixture(tx);
      await seedBenchmarkFixture(tx);
    },
    { maxWait: 60_000, timeout: 300_000 },
  );
}
