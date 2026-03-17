# PostgreSQL Schema Design — Complete Reference

## 1. Design Decisions

### 1.1 UUID Primary Keys

**Decision**: All tables use `uuid()` (UUID v4) for primary keys.

| Rationale |
|-----------|
| **Distributed-friendly**: UUIDs can be generated client-side without DB round-trip |
| **No sequential leakage**: IDs don't reveal creation order or volume |
| **Merge-safe**: Multiple systems can generate IDs without collision |
| **Supabase/PostgreSQL**: Native support, no extension required |

### 1.2 Soft Deletes (`deletedAt`)

**Decision**: Core entities use nullable `deletedAt` instead of hard delete.

| Entity | Soft Delete |
|--------|-------------|
| User, Business, Location | ✓ |
| Staff, Service, ServiceCategory | ✓ |
| Customer | ✓ |
| CustomerNote | ✓ |
| Appointment, Payment | No (use status + cancelledAt) |

**Rationale**: Recoverable deletions, audit trail, referential integrity for historical data.

### 1.3 Table Naming (`@@map`)

Prisma models use PascalCase; tables use snake_case via `@@map`:

| Model | Table |
|-------|-------|
| User | users |
| Business | businesses |
| BusinessUser | business_users |
| Staff | staff |
| Service | services |
| Appointment | appointments |
| etc. | etc. |

### 1.4 Multi-Tenancy

**Row-level tenancy**: Every tenant-scoped table has `businessId` (formerly `tenantId`).

- **Index**: `(businessId)` on all business-scoped tables
- **Composite indexes**: `(businessId, startTime)`, `(businessId, status)` for common queries
- **Isolation**: Application layer enforces `WHERE businessId = :currentBusiness`

### 1.5 Overlapping Appointments Prevention

**Constraint**: `appointments_no_overlap` (EXCLUDE using `btree_gist`)

```sql
EXCLUDE USING gist (staff_id WITH =, tsrange(start_time, end_time) WITH &&)
WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'))
```

- Same staff cannot have two non-cancelled appointments that overlap in time
- Uses PostgreSQL `tsrange` and `&&` (overlaps) operator
- `btree_gist` allows `staff_id WITH =` in the exclusion

### 1.6 Slot Locking

- **slotKey**: Unique per appointment, format `businessId:staffId:YYYY-MM-DD:HH:mm`
- **AppointmentSlot**: Short-lived lock for concurrent booking (expires after checkout timeout)
- **Unique on slotKey**: Prevents double-booking at insert time

### 1.7 Staff Availability Model

| Table | Purpose |
|-------|---------|
| **staff_working_hours** | Recurring weekly schedule (e.g., Mon 09:00–17:00) |
| **staff_breaks** | Breaks within a shift (e.g., lunch 12:00–13:00) |
| **staff_time_off** | Vacation, sick days (date range) |
| **business_holidays** | Business-wide closed days |
| **staff_availability_cache** | Precomputed slots for fast booking queries |

---

## 2. PostgreSQL Indexes

### 2.1 Tenant Isolation & List Queries

| Table | Index | Purpose |
|-------|-------|---------|
| business_users | (businessId) | List users in business |
| business_users | (userId) | List businesses for user |
| locations | (businessId) | List locations |
| services | (businessId) | List services |
| staff | (businessId) | List staff |
| customers | (businessId) | List customers |
| appointments | (businessId) | List appointments |
| waitlist | (businessId) | List waitlist |
| payments | (businessId) | List payments |
| notifications | (businessId) | List notifications |
| audit_logs | (businessId) | List audit logs |

### 2.2 High-Performance Booking Queries

| Table | Index | Purpose |
|-------|-------|---------|
| appointments | (businessId, startTime) | Dashboard, calendar view |
| appointments | (businessId, status) | Filter by status |
| appointments | (staffId) | Staff schedule |
| appointments | (staffId, startTime, endTime) | Overlap checks, availability |
| appointments | (slotKey) UNIQUE | Slot locking |
| appointment_slots | (businessId, slotTime) | Lock lookup |
| appointment_slots | (expiresAt) | Cleanup expired locks |
| staff_working_hours | (staffId) | Weekly schedule |
| staff_working_hours | (staffId, dayOfWeek) UNIQUE | Per-day lookup |
| staff_breaks | (staffId, dayOfWeek) | Breaks per day |
| staff_time_off | (staffId, startDate, endDate) | Time-off lookup |
| staff_availability_cache | (staffId, date) | Cached slots |
| staff_availability_cache | (staffId, slotStart, slotEnd) | Slot availability |

### 2.3 Customer & Search

| Table | Index | Purpose |
|-------|-------|---------|
| customers | (businessId, email) UNIQUE | Lookup by email |
| customers | (businessId, email) | Search |
| customer_notes | (customerId, createdAt) | Notes timeline |
| loyalty_points | (customerId) UNIQUE | Points lookup |

### 2.4 Audit & Notifications

| Table | Index | Purpose |
|-------|-------|---------|
| audit_logs | (businessId, createdAt) | Time-range queries |
| audit_logs | (resource, resourceId) | Resource history |
| notifications | (userId, readAt) | Unread count |

---

## 3. Unique Constraints

| Table | Constraint | Purpose |
|-------|------------|---------|
| users | email | One account per email |
| businesses | slug | URL-friendly identifier |
| business_users | (businessId, userId) | One membership per user per business |
| roles | (businessId, slug) | Unique role slug per business |
| permissions | slug | Global permission slug |
| role_permissions | (roleId, permissionId) | No duplicate role-permission |
| locations | (businessId, slug) | Unique location slug |
| service_categories | (businessId, slug) | Unique category slug |
| services | (businessId, slug) | Unique service slug |
| staff_services | (staffId, serviceId) | No duplicate staff-service |
| staff_working_hours | (staffId, dayOfWeek) | One schedule per day |
| business_holidays | (businessId, date) | One holiday per date |
| customers | (businessId, email) | One customer per email per business |
| loyalty_points | (customerId) | One points record per customer |
| appointments | slotKey | Slot locking |
| appointment_slots | slotKey | Lock uniqueness |
| refresh_tokens | token | Token lookup |

---

## 4. Foreign Key Strategy

| Parent | Child | On Delete |
|--------|-------|-----------|
| Business | Location, Staff, Customer, etc. | CASCADE |
| User | BusinessUser, RefreshToken | CASCADE |
| Staff | Appointment, StaffWorkingHours | RESTRICT (prevent orphan) |
| Customer | Appointment | RESTRICT |
| Service | Appointment | RESTRICT |
| Appointment | Payment | SET NULL (keep payment record) |

---

## 5. Entity Summary

| Entity | Table | Key Fields |
|--------|-------|------------|
| User | users | email, passwordHash, authProvider |
| Business | businesses | name, slug, type, timezone |
| BusinessUser | business_users | businessId, userId, roleId |
| Role | roles | name, slug, isSystem |
| Permission | permissions | resource, action, slug |
| Location | locations | businessId, name, slug |
| ServiceCategory | service_categories | businessId, name, slug |
| Service | services | businessId, durationMinutes, price |
| Staff | staff | businessId, userId?, locationId? |
| StaffService | staff_services | staffId, serviceId |
| StaffWorkingHours | staff_working_hours | staffId, dayOfWeek, startTime, endTime |
| StaffBreak | staff_breaks | staffId, dayOfWeek, startTime, endTime |
| StaffTimeOff | staff_time_off | staffId, startDate, endDate |
| BusinessHoliday | business_holidays | businessId, date |
| StaffAvailabilityCache | staff_availability_cache | staffId, date, slotStart, slotEnd |
| Customer | customers | businessId, email |
| CustomerNote | customer_notes | customerId, note |
| LoyaltyPoints | loyalty_points | customerId, points |
| Appointment | appointments | staffId, customerId, serviceId, startTime, endTime |
| AppointmentSlot | appointment_slots | appointmentId, slotKey, expiresAt |
| Waitlist | waitlist | businessId, customerId, serviceId |
| Payment | payments | businessId, appointmentId?, amount |
| Subscription | subscriptions | businessId, stripeSubscriptionId |
| Notification | notifications | businessId, userId?, type |
| AuditLog | audit_logs | businessId, resource, resourceId |
