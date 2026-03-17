# High Performance Architecture

## 1. Frontend Data Strategy (TanStack Query)

**When implementing the Next.js frontend:**

| Resource | Cache Key | Stale Time | Refetch |
|----------|-----------|-------------|---------|
| Business info | `business:{slug}` | 10 min | On window focus |
| Staff list | `staff:list:{businessId}` | 5 min | Background |
| Services list | `services:list:{businessId}` | 5 min | Background |
| Appointments | `appointments:{filters}` | 1 min | On mutation |
| Availability | `availability:{staffId}:{date}` | 1 min | On slot select |

**Rules:**
- Use `staleTime` to avoid refetch on every navigation
- Use `gcTime` (cacheTime) to keep data for 5–10 min after unmount
- Optimistic updates for create/update/delete
- Pagination: `useInfiniteQuery` for lists
- Never refetch on mount if data is fresh

---

## 2. Redis Caching Strategy

| Key Pattern | TTL | Invalidation Trigger |
|-------------|-----|----------------------|
| `business:{slug}` | 10 min | Business update |
| `staff:list:{businessId}` | 5 min | Staff create/update/delete |
| `services:list:{businessId}` | 5 min | Service create/update/delete |
| `appointments:day:{staffId}:{date}` | 1 min | Appointment create/update/cancel |
| `availability:{staffId}:{date}` | 1 min | Availability regeneration |
| `lock:slot:{staffId}:{date}:{time}` | 10 min | Auto-expire (booking lock) |

**Invalidation:**
- `CacheService.invalidateBusiness(businessId)` — staff, services, appointments
- `CacheService.invalidateStaff(staffId)` — availability, appointments
- `CacheService.invalidateAvailability(staffId, date)` — single day

---

## 3. Availability Engine (Precomputation)

**Table:** `staff_availability_cache`

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| staffId | UUID | Staff reference |
| date | Date | Date (no time) |
| slots | JSON | `["09:00", "09:30", "10:00", ...]` |
| generatedAt | DateTime | When computed |

**One row per staff per date.** Slots are 30-minute intervals by default.

---

## 4. Availability Generation (BullMQ)

**Queue:** `availability`

**Triggers:**
- Working hours change → queue affected staff + next 30 days
- Breaks change → same
- Time off change → same
- Appointment create/update/cancel → queue staff + date
- New day (cron) → queue all active staff for today + tomorrow

**Worker:** `AvailabilityWorkerService.processJob()`
- Computes slots from working hours, breaks, time off, holidays
- Upserts into `staff_availability_cache`
- Invalidates Redis cache

---

## 5. Booking Lock System (Redis)

**Key:** `lock:slot:{staffId}:{date}:{time}`  
**TTL:** 10 minutes

**Flow:**
1. User selects slot → `SlotLockService.acquireLock()`
2. If acquired: proceed to checkout
3. On confirm: create appointment, `releaseLock()` (optional, lock expires anyway)
4. On abandon: lock expires after 10 min

**Methods:**
- `acquireLock(staffId, date, time)` — NX set with TTL
- `releaseLock(staffId, date, time)` — DEL
- `getLockedSlots(staffId, date)` — KEYS pattern, used when filtering availability

---

## 6. Slot Reservation Logic

**`AvailabilityService.getAvailableSlots(staffId, date)`:**

1. Read from `staff_availability_cache` (precomputed slots)
2. Get locked slots from Redis (`getLockedSlots`)
3. Query appointments for staff+date (exclude CANCELLED, NO_SHOW)
4. Filter: remove locked + overlapping
5. Return remaining slots

---

## 7. Background Jobs (BullMQ)

| Queue | Purpose |
|-------|---------|
| `availability` | Regenerate availability cache |
| `notification` | Reminder SMS, waitlist notifications |
| `analytics` | Daily aggregation, reports |

---

## 8. API Performance

**Required on list endpoints:**
- Pagination: `cursor` or `offset` + `limit`
- Date filters: `startDate`, `endDate`
- Staff filter: `staffId`
- Never return > 100 items per page

**Example:** `GET /appointments?businessId=x&startDate=2025-03-01&endDate=2025-03-31&staffId=y&limit=50`

---

## 9. Database Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| appointments | (staffId, startTime) | Staff schedule |
| appointments | (businessId, startTime) | Business calendar |
| staff_services | (staffId) | Staff's services |
| customers | (phone) | Phone lookup |

---

## 10. Frontend Navigation (Next.js App Router)

- **Server Components** for initial data (no client fetch for above-the-fold)
- **Streaming** with `loading.tsx` for progressive rendering
- **Partial rendering** — only changed segments re-render
- **Suspense** around async components
- **Optimistic UI** — update cache before server confirms
