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

**Decision**: Row-level tenancy with `businessId` on every tenant-scoped table. Prisma middleware enforces tenant context. Suitable for thousands of businesses with moderate data isolation requirements.

### 1.2 Naming Conventions

- **Tables**: PascalCase singular (`Tenant`, `Booking`, `Staff`)
- **Columns**: camelCase (`tenantId`, `createdAt`, `isActive`)
- **Indexes**: `idx_<table>_<columns>` for performance
- **Foreign keys**: `<referencedTable>Id` (e.g., `businessId`, `userId`)

### 1.3 Audit & Soft Delete

- **Audit**: `AuditLog` table for critical mutations; `updatedAt` on all tables
- **Soft delete**: `deletedAt` (nullable timestamp) for recoverable deletions on core entities

---

## 2. Entity Relationship Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Business   │────<│ BusinessUser │>────│    User     │
└─────────────┘     └──────────────┘     └─────────────┘
       │                     │
       │                     └──────────> Role
       │
       ├──> Branch ──> Staff ──> StaffAvailabilityCache
       │         │          │
       │         └──> Service (ServiceCategory)
       │
       ├──> Customer
       │
       ├──> Appointment ──> AppointmentSlot (slot locking)
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
| **Business** | Business/organization (barber shop, salon, gym, clinic) |
| **User** | Global user identity (email/phone-based, can belong to multiple businesses) |
| **BusinessUser** | User's role and membership within a business |
| **Role** | RBAC role (e.g., Owner, Admin, Staff, Customer) |
| **Permission** | Granular permission (e.g., `booking:create`, `staff:manage`) |
| **RolePermission** | Many-to-many: Role ↔ Permission |

### 3.2 Business Structure

| Entity | Purpose |
|--------|---------|
| **Branch** | Physical location (supports multi-branch businesses) |
| **Staff** | Staff member linked to User (optional) and Branch |
| **Service** | Service offered (haircut, massage, etc.) |
| **ServiceCategory** | Grouping for services |
| **StaffService** | Which staff can perform which services |

### 3.3 Scheduling & Booking

| Entity | Purpose |
|--------|---------|
| **StaffWorkingHours**, **StaffBreak**, **StaffTimeOff** | Availability model |
| **Appointment** | Appointment record |
| **AppointmentSlot** | Slot locking for concurrent booking prevention |
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
| All business tables | `(businessId)` | Tenant isolation, list queries |
| Appointment | `(businessId, startTime)`, `(businessId, status)` | Dashboard, filtering |
| AppointmentSlot | `(slotKey)` UNIQUE | Slot locking, prevent double-book |
| StaffWorkingHours | `(staffId, dayOfWeek)` | Availability lookup |
| AuditLog | `(businessId, createdAt)` | Time-range audit queries |
| Notification | `(userId, readAt)` | Unread notifications |

---

## 5. Caching Strategy (Redis) — Preview

| Key Pattern | TTL | Use Case |
|-------------|-----|----------|
| `business:{id}` | 1h | Business config |
| `availability:{staffId}:{date}` | 5m | Availability slots |
| `lock:slot:{staffId}:{date}:{time}` | 10m | Booking slot lock |
| `user:{id}:permissions` | 15m | RBAC check |

---

## 6. Event System — Preview

| Event | Producers | Consumers |
|-------|-----------|-----------|
| `appointment.created` | AppointmentService | Notification, Analytics |
| `appointment.cancelled` | AppointmentService | Notification, Waitlist |
| `payment.completed` | PaymentService | Booking confirmation |
| `slot.released` | BookingService | Waitlist automation |

---

## 7. Phase 1 Deliverables

- [x] Architecture document
- [x] Prisma schema (full)
- [x] Database migrations
- [x] Seed script for roles/permissions
- [ ] Docker Compose (optional; Supabase/Upstash recommended)
