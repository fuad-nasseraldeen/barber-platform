# Barbershop SaaS Platform

Production-grade multi-tenant SaaS platform for service-based businesses (barber shops, beauty salons, gyms, clinics).

## Tech Stack

- **Backend**: NestJS, TypeScript, Prisma ORM, PostgreSQL, Redis, BullMQ, Stripe, Supabase Storage
- **Frontend** (Phase 10): Next.js 14, TypeScript, TailwindCSS, TanStack Query, Zustand

## Phase 1: Database Architecture ✓

Phase 1 delivers the complete database schema, migrations, and infrastructure.

### Design Decisions

1. **Multi-tenancy**: Row-level tenancy with `tenantId` on all tenant-scoped tables. Single database for cost efficiency; Prisma middleware will enforce tenant context.

2. **RBAC**: Role-Permission model. System roles (null `tenantId`) are shared; tenant-specific roles allow customization. Permissions use `resource:action` slugs (e.g., `booking:create`).

3. **Slot locking**: `BookingSlot` table with unique `slotKey` prevents double-booking. Slot keys follow `tenantId:staffId:YYYY-MM-DD:HH:mm`.

4. **Soft delete**: `deletedAt` on core entities (Tenant, User, Location, Staff, Service, Customer) for recoverable deletions.

5. **Indexing**: Composite indexes on `(tenantId, startTime)`, `(tenantId, status)` for booking queries; `(slotKey)` unique for locking.

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL and Redis (requires Docker)
npm run docker:up

# 3. Run migrations
npm run prisma:migrate

# 4. Seed permissions
npm run prisma:seed

# 5. Start development server
npm run start:dev
```

### Environment

Copy `.env.example` to `.env` and adjust values. Default `DATABASE_URL` matches Docker Compose:

```
DATABASE_URL="postgresql://barber:barber_secret@localhost:5432/barber_saas?schema=public"
REDIS_URL="redis://localhost:6379"
```

### Database Schema Overview

| Domain | Entities |
|--------|----------|
| Tenant & Identity | Tenant, User, TenantUser, Role, Permission, RolePermission, RefreshToken |
| Business | Location, ServiceCategory, Service, Staff, StaffService |
| Availability | StaffAvailability |
| Booking | Customer, Booking, BookingSlot |
| Waitlist | Waitlist |
| Payments | Payment, Subscription |
| System | Notification, AuditLog |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design.

### Next Phases

- **Phase 2**: Authentication System
- **Phase 3**: Business Management
- **Phase 4**: Staff Management
- **Phase 5**: Booking Engine
- **Phase 6**: Availability Engine
- **Phase 7**: Payments
- **Phase 8**: Notifications
- **Phase 9**: Analytics
- **Phase 10**: Frontend Dashboards
