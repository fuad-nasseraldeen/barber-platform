/**
 * Barbershop Platform - Minimal Seed
 * Run: npm run prisma:seed
 *
 * Creates only permissions and system roles.
 * No businesses, staff, customers, or appointments.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { resource: 'business', action: 'create', slug: 'business:create' },
  { resource: 'business', action: 'read', slug: 'business:read' },
  { resource: 'business', action: 'update', slug: 'business:update' },
  { resource: 'business', action: 'manage', slug: 'business:manage' },
  { resource: 'user', action: 'create', slug: 'user:create' },
  { resource: 'user', action: 'read', slug: 'user:read' },
  { resource: 'user', action: 'update', slug: 'user:update' },
  { resource: 'user', action: 'delete', slug: 'user:delete' },
  { resource: 'user', action: 'manage', slug: 'user:manage' },
  { resource: 'location', action: 'create', slug: 'location:create' },
  { resource: 'location', action: 'read', slug: 'location:read' },
  { resource: 'location', action: 'update', slug: 'location:update' },
  { resource: 'location', action: 'delete', slug: 'location:delete' },
  { resource: 'location', action: 'manage', slug: 'location:manage' },
  { resource: 'staff', action: 'create', slug: 'staff:create' },
  { resource: 'staff', action: 'read', slug: 'staff:read' },
  { resource: 'staff', action: 'update', slug: 'staff:update' },
  { resource: 'staff', action: 'delete', slug: 'staff:delete' },
  { resource: 'staff', action: 'manage', slug: 'staff:manage' },
  { resource: 'service', action: 'create', slug: 'service:create' },
  { resource: 'service', action: 'read', slug: 'service:read' },
  { resource: 'service', action: 'update', slug: 'service:update' },
  { resource: 'service', action: 'delete', slug: 'service:delete' },
  { resource: 'service', action: 'manage', slug: 'service:manage' },
  { resource: 'customer', action: 'create', slug: 'customer:create' },
  { resource: 'customer', action: 'read', slug: 'customer:read' },
  { resource: 'customer', action: 'update', slug: 'customer:update' },
  { resource: 'customer', action: 'delete', slug: 'customer:delete' },
  { resource: 'customer', action: 'manage', slug: 'customer:manage' },
  { resource: 'appointment', action: 'create', slug: 'appointment:create' },
  { resource: 'appointment', action: 'read', slug: 'appointment:read' },
  { resource: 'appointment', action: 'update', slug: 'appointment:update' },
  { resource: 'appointment', action: 'delete', slug: 'appointment:delete' },
  { resource: 'appointment', action: 'manage', slug: 'appointment:manage' },
  { resource: 'availability', action: 'read', slug: 'availability:read' },
  { resource: 'availability', action: 'update', slug: 'availability:update' },
  { resource: 'availability', action: 'manage', slug: 'availability:manage' },
  { resource: 'payment', action: 'read', slug: 'payment:read' },
  { resource: 'payment', action: 'create', slug: 'payment:create' },
  { resource: 'payment', action: 'manage', slug: 'payment:manage' },
  { resource: 'waitlist', action: 'create', slug: 'waitlist:create' },
  { resource: 'waitlist', action: 'read', slug: 'waitlist:read' },
  { resource: 'waitlist', action: 'update', slug: 'waitlist:update' },
  { resource: 'waitlist', action: 'manage', slug: 'waitlist:manage' },
  { resource: 'analytics', action: 'read', slug: 'analytics:read' },
  { resource: 'audit', action: 'read', slug: 'audit:read' },
];

const SYSTEM_ROLES = [
  {
    slug: 'owner',
    name: 'Owner',
    permissions: [
      'business:read',
      'business:manage',
      'staff:read',
      'staff:create',
      'staff:update',
      'staff:delete',
      'staff:manage',
      'user:manage',
      'analytics:read',
      'waitlist:read',
      'waitlist:manage',
      'appointment:read',
      'appointment:update',
      'payment:read',
      'location:manage',
      'service:read',
      'service:create',
      'service:manage',
      'customer:manage',
    ],
  },
  {
    slug: 'manager',
    name: 'Manager',
    permissions: [
      'business:read',
      'business:update',
      'staff:read',
      'staff:create',
      'staff:update',
      'staff:delete',
      'staff:manage',
      'analytics:read',
      'waitlist:read',
      'waitlist:update',
      'appointment:read',
      'appointment:update',
      'customer:read',
      'customer:update',
      'customer:delete',
      'location:read',
      'location:create',
      'location:update',
      'location:delete',
      'service:read',
      'service:create',
      'service:update',
      'service:delete',
      'service:manage',
    ],
  },
  {
    slug: 'staff',
    name: 'Staff',
    permissions: [
      'business:read',
      'staff:read',
      'appointment:read',
      'appointment:update',
      'customer:read',
      'waitlist:read',
      'waitlist:update',
      'location:read',
      'service:read',
      'analytics:read',
    ],
  },
  { slug: 'customer', name: 'Customer', permissions: ['business:read', 'appointment:create', 'appointment:read'] },
];

async function main() {
  console.log('Seeding permissions...');
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { slug: p.slug }, create: p, update: {} });
  }
  console.log(`Created/updated ${PERMISSIONS.length} permissions.`);

  console.log('Seeding system roles...');
  for (const role of SYSTEM_ROLES) {
    let r = await prisma.role.findFirst({
      where: { slug: role.slug, businessId: null, isSystem: true },
    });
    if (!r) {
      r = await prisma.role.create({
        data: { name: role.name, slug: role.slug, businessId: null, isSystem: true },
      });
    }
    for (const permSlug of role.permissions) {
      const perm = await prisma.permission.findUnique({ where: { slug: permSlug } });
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: r.id, permissionId: perm.id } },
          create: { roleId: r.id, permissionId: perm.id },
          update: {},
        });
      }
    }
  }
  console.log(`Created/updated ${SYSTEM_ROLES.length} system roles.`);
  console.log('Seed completed. Database is clean (no businesses, staff, customers).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
