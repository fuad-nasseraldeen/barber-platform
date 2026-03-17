# SaaS Platform Architecture — Phase 1: Database Design

## Executive Summary

This document defines the database architecture for a production-grade, multi-tenant SaaS platform serving barber shops, beauty salons, gyms, and clinics. The design prioritizes **scalability**, **tenant isolation**, **auditability**, and **performance**.

---

## 1. Design Principles

### 1.1 Multi-Tenancy Strategy

**Chosen approach: Row-Level Tenancy (Shared Database)**

| Approach | Pros | Cons |
|----------|------|------|
| **Row-Level** ✓ | Simple ops, cost-effective, easy cross-tenant analytics | Requires strict tenant_id filtering |
| Schema-per-tenant | Strong isolation | Complex migrations, connection overhead |
| Database-per-tenant | Maximum isolation | High cost, operational complexity |

**Decision**: Row-level tenancy with `tenantId` on every tenant-scoped table. Prisma middleware enforces tenant context. Suitable for thousands of businesses with moderate data isolation requirements.

### 1.2 Naming Conventions

- **Tables**: PascalCase singular (`Tenant`, `Booking`, `Staff`)
- **Columns**: camelCase (`tenantId`, `createdAt`, `isActive`)
- **Indexes**: `idx_<table>_<columns>` for performance
- **Foreign keys**: `<referencedTable>Id` (e.g., `tenantId`, `userId`)

### 1.3 Audit & Soft Delete

- **Audit**: `AuditLog` table for critical mutations; `updatedAt` on all tables
- **Soft delete**: `deletedAt` (nullable timestamp) for recoverable deletions on core entities

---

## 2. Entity Relationship Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Tenant    │────<│  TenantUser  │>────│    User     │
└─────────────┘     └──────────────┘     └─────────────┘
       │                     │
       │                     └──────────> Role
       │
       ├──> Location ──> Staff ──> StaffAvailability
       │         │          │
       │         └──> Service (ServiceCategory)
       │
       ├──> Customer
       │
       ├──> Booking ──> BookingSlot (slot locking)
       │         │
       │         └──> Payment
       │
       ├──> Waitlist
       ├──> Notification
       ├──> AuditLog
       └──> Subscription (Stripe)
```

---

## 3. Core Domain Entities

### 3.1 Tenant & Identity

| Entity | Purpose |
|--------|---------|
| **Tenant** | Business/organization (barber shop, salon, gym, clinic) |
| **User** | Global user identity (email-based, can belong to multiple tenants) |
| **TenantUser** | User's role and membership within a tenant |
| **Role** | RBAC role (e.g., Owner, Admin, Staff, Customer) |
| **Permission** | Granular permission (e.g., `booking:create`, `staff:manage`) |
| **RolePermission** | Many-to-many: Role ↔ Permission |

### 3.2 Business Structure

| Entity | Purpose |
|--------|---------|
| **Location** | Physical location (supports multi-location businesses) |
| **Staff** | Staff member linked to User (optional) and Location |
| **Service** | Service offered (haircut, massage, etc.) |
| **ServiceCategory** | Grouping for services |
| **StaffService** | Which staff can perform which services |

### 3.3 Scheduling & Booking

| Entity | Purpose |
|--------|---------|
| **StaffAvailability** | Recurring and override availability |
| **Booking** | Appointment record |
| **BookingSlot** | Slot locking for concurrent booking prevention |
| **Waitlist** | Waitlist entries when no slots available |

### 3.4 Payments & Billing

| Entity | Purpose |
|--------|---------|
| **Customer** | Customer profile (can have Stripe customer ID) |
| **Payment** | Payment record (Stripe payment intent, etc.) |
| **Subscription** | Stripe subscription for SaaS billing |

### 3.5 System

| Entity | Purpose |
|--------|---------|
| **Notification** | In-app and push notifications |
| **AuditLog** | Immutable audit trail for compliance |
| **RefreshToken** | JWT refresh token storage |

---

## 4. Indexing Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| All tenant tables | `(tenantId)` | Tenant isolation, list queries |
| Booking | `(tenantId, startTime)`, `(tenantId, status)` | Dashboard, filtering |
| BookingSlot | `(tenantId, slotKey)` UNIQUE | Slot locking, prevent double-book |
| StaffAvailability | `(staffId, dayOfWeek)` | Availability lookup |
| AuditLog | `(tenantId, createdAt)` | Time-range audit queries |
| Notification | `(userId, readAt)` | Unread notifications |

---

## 5. Caching Strategy (Redis) — Preview

| Key Pattern | TTL | Use Case |
|-------------|-----|----------|
| `tenant:{id}` | 1h | Tenant config |
| `availability:{staffId}:{date}` | 5m | Availability slots |
| `slot_lock:{tenantId}:{slotKey}` | 15m | Booking slot lock |
| `user:{id}:permissions` | 15m | RBAC check |

---

## 6. Event System — Preview

| Event | Producers | Consumers |
|-------|-----------|-----------|
| `booking.created` | BookingService | Notification, Analytics |
| `booking.cancelled` | BookingService | Notification, Waitlist |
| `payment.completed` | PaymentService | Booking confirmation |
| `slot.released` | BookingService | Waitlist automation |

---

## 7. Phase 1 Deliverables

- [x] Architecture document
- [ ] Prisma schema (full)
- [ ] Docker Compose (PostgreSQL, Redis)
- [ ] Database migrations
- [ ] Seed script for roles/permissions
