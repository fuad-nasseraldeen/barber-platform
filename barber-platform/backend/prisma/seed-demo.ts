/**
 * Demo seed: 10 Hebrew customers + 20 mixed appointments
 * Run: npx ts-node prisma/seed-demo.ts
 *
 * Requires: existing business with at least 2 staff (manager + employee) and a branch.
 * Creates services if missing: תספורת, תספורת + זקן, תספורת ילד
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HEBREW_CUSTOMERS = [
  { firstName: 'יוסי', lastName: 'כהן', phone: '0501111111' },
  { firstName: 'דוד', lastName: 'לוי', phone: '0502222222' },
  { firstName: 'משה', lastName: 'אברהם', phone: '0503333333' },
  { firstName: 'רחל', lastName: 'גולדמן', phone: '0504444444' },
  { firstName: 'שרה', lastName: 'מזרחי', phone: '0505555555' },
  { firstName: 'יעקב', lastName: 'שמעון', phone: '0506666666' },
  { firstName: 'מיכל', lastName: 'דהן', phone: '0507777777' },
  { firstName: 'אריאל', lastName: 'בן דוד', phone: '0508888888' },
  { firstName: 'נועה', lastName: 'פרץ', phone: '0509999999' },
  { firstName: 'דניאל', lastName: 'רוזן', phone: '0521234567' },
];

const SERVICE_NAMES = [
  { name: 'תספורת', slug: 'haircut', duration: 30, price: 80 },
  { name: 'תספורת + זקן', slug: 'haircut-beard', duration: 45, price: 120 },
  { name: 'תספורת ילד', slug: 'haircut-child', duration: 25, price: 60 },
];

async function main() {
  const business = await prisma.business.findFirst({
    where: { deletedAt: null },
    include: {
      branches: { take: 1 },
      staff: { where: { deletedAt: null, isActive: true } },
    },
  });

  if (!business) {
    console.error('No business found. Create a business first (register a shop).');
    process.exit(1);
  }

  const branchId = business.branches[0]?.id ?? null;
  const staffList = business.staff;
  if (staffList.length < 2) {
    console.error('Need at least 2 staff. Current:', staffList.length);
    process.exit(1);
  }

  const staffA = staffList[0];
  const staffB = staffList[1];

  // Ensure services exist and staff can perform them
  const services: { id: string; durationMinutes: number; price: number }[] = [];
  for (const svc of SERVICE_NAMES) {
    let s = await prisma.service.findFirst({
      where: { businessId: business.id, slug: svc.slug, deletedAt: null },
    });
    if (!s) {
      s = await prisma.service.create({
        data: {
          businessId: business.id,
          branchId,
          name: svc.name,
          slug: svc.slug,
          durationMinutes: svc.duration,
          price: svc.price,
        },
      });
      console.log('Created service:', svc.name);
    }
    services.push({ id: s.id, durationMinutes: s.durationMinutes, price: Number(s.price) });

    for (const staff of [staffA, staffB]) {
      await prisma.staffService.upsert({
        where: {
          staffId_serviceId: { staffId: staff.id, serviceId: s.id },
        },
        create: {
          staffId: staff.id,
          serviceId: s.id,
          durationMinutes: svc.duration,
          price: svc.price,
        },
        update: {},
      });
    }
  }

  // Create 10 Hebrew customers
  const customers: { id: string }[] = [];
  for (let i = 0; i < HEBREW_CUSTOMERS.length; i++) {
    const c = HEBREW_CUSTOMERS[i];
    const email = `demo-customer-${i + 1}-${Date.now()}@demo.local`;
    const cust = await prisma.customer.create({
      data: {
        businessId: business.id,
        branchId,
        email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
      },
    });
    customers.push({ id: cust.id });
  }
  console.log('Created 10 Hebrew customers.');

  // Create 20 appointments - mixed staff, mixed services, various dates
  const now = new Date();
  let created = 0;

  for (let i = 0; i < 20; i++) {
    const customer = customers[i % 10];
    const staff = i % 2 === 0 ? staffA : staffB;
    const service = services[i % 3];
    const dayOffset = Math.floor(i / 4);
    const hourOffset = Math.floor(i / 2) % 6;
    const date = new Date(now);
    date.setDate(date.getDate() - 10 + dayOffset);
    date.setHours(9 + hourOffset, (i % 2) * 30, 0, 0);

    const dateStr = date.toISOString().slice(0, 10);
    const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const slotKey = `${business.id}:${staff.id}:${dateStr}:${timeStr}`;

    const endDate = new Date(date);
    endDate.setMinutes(endDate.getMinutes() + service.durationMinutes);

    try {
      await prisma.appointment.create({
        data: {
          businessId: business.id,
          branchId,
          customerId: customer.id,
          staffId: staff.id,
          serviceId: service.id,
          startTime: date,
          endTime: endDate,
          status: i % 5 === 0 ? 'PENDING' : 'COMPLETED',
          slotKey,
        },
      });
      created++;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        console.warn('Slot collision, skipping:', slotKey);
        continue;
      }
      throw e;
    }
  }

  console.log(`Created ${created} appointments (mixed manager/employee, תספורת / תספורת+זקן / תספורת ילד).`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
