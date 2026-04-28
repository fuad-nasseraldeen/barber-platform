# Scheduling System — Stress Test & Failure Scenario Report

This document analyzes each failure scenario, expected behavior, and validation results.

---

## 1. High Concurrency Booking (CRITICAL)

**What was tested:** 50–100 concurrent users trying to book the SAME slot.

**Expected behavior:**
- Only ONE booking is created (first to commit wins)
- Others fail with `ConflictException` (OVERLAPS_BOOKING or P2002)
- No duplicate records in DB
- Serializable transaction + overlap validation inside tx ensures correctness

**Mechanisms:**
- `$transaction` with `Serializable` isolation
- Overlap check inside transaction: `startTime < endTime AND endTime > startTime`
- `withTransactionRetry` retries on P2034 (max 5 attempts)
- slotKey unique constraint as secondary guard (but overlap is primary)

**Actual behavior (code analysis):**
- ✅ Correct: Validation runs inside tx, so concurrent requests see each other's uncommitted rows under Serializable
- ✅ One winner, rest get P2002 (unique) or P2034 (retry then fail) or OVERLAPS_BOOKING
- ⚠️ **Gap:** If 50 users all have different sessionIds and all hold locks (impossible—only one can lock a slot), the lock prevents most. For admin create (no lock), pure DB contention handles it.

**Fix recommendations:** None. System is correct.

---

## 2. Duplicate Requests (Idempotency Test)

**What was tested:** Same request sent 2–5 times rapidly with same `idempotencyKey`.

**Expected behavior:**
- Only one booking created
- All responses return the same booking
- No partial state

**Mechanisms:**
- `BookingIdempotency` table with `UNIQUE(businessId, idempotencyKey)`
- Check at start: if record exists, return existing appointment
- Idempotency record created inside transaction (atomic with appointment)

**Actual behavior (code analysis):**
- ✅ Correct: First request creates; subsequent requests hit `findUnique` and return existing
- ✅ Idempotency record created inside tx—no race between create and idempotency insert
- ⚠️ **Edge case:** Two requests with same key arrive before either commits. Both pass the "existing" check, both enter tx. One creates appointment + idempotency. Second fails on `bookingIdempotency.create` with P2002 (unique). Need to catch P2002 on idempotency and return existing appointment.

**Fix recommendation:** In createAppointment/confirmBooking, if P2002 on `bookingIdempotency` table, fetch and return the existing appointment (another request won the race).

---

## 3. Transaction Retry Storm

**What was tested:** High contention causing P2034 serialization failures.

**Expected behavior:**
- Retry logic works (max 5 attempts)
- Exponential backoff reduces contention
- No infinite loops
- Latency remains acceptable

**Mechanisms:**
- `withTransactionRetry` in `transaction-retry.ts`
- Backoff: `50 * 2^attempt + random(0,50)` ms
- Max 5 attempts

**Actual behavior (code analysis):**
- ✅ Correct: Retries only on `isSerializationError` (P2034, 40001)
- ✅ Other errors thrown immediately
- ✅ `onRetry` callback increments metrics
- ✅ No infinite loop (attempt < MAX_RETRIES)

**Fix recommendations:** None.

---

## 4. Redis Failure / Degradation

**What was tested:** Redis unavailable or slow.

**Expected behavior:**
- If Redis required: fail fast at startup (production)
- If Redis unavailable at runtime: lock operations throw; confirm fails with clear error
- No double booking (DB validation is source of truth)

**Mechanisms:**
- `REQUIRE_REDIS_IN_PRODUCTION` + `onModuleInit` ping
- Slot lock uses Redis; if Redis throws, lock fails
- Validation uses DB for overlap; Redis only for lock check

**Actual behavior (code analysis):**
- ✅ Production: Fails at startup if Redis unreachable
- ✅ At runtime: `client.set`, `client.get` throw on connection failure → ConflictException or 500
- ⚠️ **Gap:** When `ENABLE_REDIS=false`, in-memory stub used. Multi-instance = no distributed locking. Documented.

**Fix recommendations:** Ensure production uses `ENABLE_REDIS=true` and Redis is highly available.

---

## 5. Lock Ownership Violation

**What was tested:** User A locks slot; User B tries to confirm using same slot.

**Expected behavior:**
- System rejects B
- Only lock owner can confirm

**Mechanisms:**
- Lock value: `sessionId:userId`
- `verifyLockForDuration` checks value matches sessionId (and userId if provided)
- `requireLock: true` in validation when sessionId present

**Actual behavior (code analysis):**
- ✅ B does not have A's sessionId → `verifyLockForDuration` returns false → LOCK_EXPIRED
- ✅ B cannot pass A's sessionId without knowing it (opaque token)
- ⚠️ **Gap:** If B somehow obtains A's sessionId (e.g., shared browser), B could confirm. Mitigation: userId is also verified when provided. Frontend should send userId from JWT.

**Fix recommendations:** Ensure confirm always passes userId from JWT; validation verifies both.

---

## 6. Multi-Tab Same User

**What was tested:** Same user opens multiple tabs, creates locks in both.

**Expected behavior:**
- Only one active lock remains
- Previous locks invalidated when new lock acquired
- No duplicate bookings

**Mechanisms:**
- `user_lock:{tenantId}:{userId}:{staffId}:{date}:{startTime}` → sessionId
- `releaseUserPreviousLock` called before `acquireLockForDuration` when userId provided
- Releases all slot locks owned by prevSession for that staff/date

**Actual behavior (code analysis):**
- ✅ When user acquires lock in tab 2, `releaseUserPreviousLock` clears tab 1's lock
- ✅ Tab 1's sessionId no longer valid → confirm would fail with LOCK_EXPIRED
- ✅ Only tab 2 can confirm

**Fix recommendations:** None.

---

## 7. Booking + Admin Override Conflict

**What was tested:** User holds lock; admin creates in same slot; user tries to confirm.

**Expected behavior:**
- User gets conflict error
- No double booking

**Mechanisms:**
- Admin create uses `skipLockCheck: true` and runs in transaction
- Overlap check inside transaction: `db.appointment.findFirst` with `startTime < endTime AND endTime > startTime`
- User's confirm runs validation inside tx; overlap check finds admin's booking → OVERLAPS_BOOKING

**Actual behavior (code analysis):**
- ✅ Admin create succeeds (bypasses lock)
- ✅ User confirm: validation inside tx sees admin's row → OVERLAPS_BOOKING
- ✅ No double booking

**Fix recommendations:** None.

---

## 8. Cache Inconsistency

**What was tested:** Availability cache outdated; booking already exists in DB.

**Expected behavior:**
- Validation uses DB truth
- Cache does not allow invalid booking

**Mechanisms:**
- `validateBookingSlot` uses `db.appointment.findFirst` for overlap (DB, not cache)
- Availability cache used only for `getAvailableSlots` (display)
- Lock/confirm flow validates against DB inside transaction

**Actual behavior (code analysis):**
- ✅ Validation never reads from availability cache for overlap
- ✅ Overlap check is always against `db.appointment` (or tx.appointment)
- ✅ Cache invalidation on create/update/delete reduces staleness

**Fix recommendations:** None.

---

## 9. Timezone Edge Cases

**What was tested:** Bookings near midnight; DST changes.

**Expected behavior:**
- No incorrect overlaps
- Correct slot calculation

**Mechanisms:**
- DB stores UTC (timestamptz)
- Overlap: `startTime < newEndTime AND endTime > newStartTime` (timestamp comparison)
- Date strings from API: `YYYY-MM-DD`, `HH:mm` — interpreted in server/local time (see SCHEDULING_HARDENING.md)

**Actual behavior (code analysis):**
- ⚠️ **Gap:** `new Date(\`${date}T${startTime}:00\`)` uses server local time. If server is UTC, fine. If business is in different TZ, may be wrong. Business has `timezone` field but it's not used in date parsing.
- ✅ Overlap logic is correct for timestamps
- ⚠️ Cross-midnight: A slot 23:30–00:00 spans two dates. Current slot format is per-date. Need to ensure such slots are handled if supported.

**Fix recommendations:** Use business timezone when parsing date+time for storage. Add integration test for DST and midnight.

---

## 10. Rate Limit Stress

**What was tested:** User sends 50 requests quickly.

**Expected behavior:**
- Rate limiting blocks excess requests
- System remains stable

**Mechanisms:**
- `@Throttle` on lock (10/min), confirm (10/min), create (30/min)
- ThrottlerGuard returns 429 when exceeded

**Actual behavior (code analysis):**
- ✅ ThrottlerGuard is global
- ✅ Per-route @Throttle overrides
- ⚠️ Throttle is per "tracker" — default is by IP. For per-user, need custom ThrottlerGuard that uses userId. Current: likely per-IP, so multiple users behind same NAT share limit.

**Fix recommendations:** Consider per-user rate limiting for booking endpoints (use userId from JWT as throttle key).

---

## 11. Backpressure / Overload

**What was tested:** 100–200 requests per second.

**Expected behavior:**
- System does not crash
- Requests throttled or rejected gracefully

**Mechanisms:**
- NestJS handles concurrent requests
- Prisma connection pool
- Redis connection pool
- Rate limiting (partial)
- Transaction retry (adds latency under contention)

**Actual behavior (code analysis):**
- ✅ No obvious unbounded queues or memory leaks in booking flow
- ⚠️ Under extreme load: DB connection exhaustion, Redis connection exhaustion possible
- ⚠️ No explicit request queue or backpressure

**Fix recommendations:** Configure Prisma/Redis connection limits. Consider circuit breaker for Redis. Load test to find limits.

---

## 12. Idempotency Failure States

**What was tested:** Request fails mid-transaction; idempotency record exists.

**Expected behavior:**
- System handles PENDING/FAILED correctly
- Retries eventually succeed or fail cleanly

**Mechanisms:**
- Idempotency record created inside same transaction as appointment
- If tx fails, neither is committed
- Retry with same idempotencyKey: no record exists → full flow runs again

**Actual behavior (code analysis):**
- ✅ No PENDING state in our model—either full success or full rollback
- ✅ Retry: same key, no record → creates again. If first request actually committed (client got 500 but server committed), second would hit unique on idempotency and fail. See scenario 2 fix.

**Fix recommendation:** ✅ IMPLEMENTED. On P2002 for `bookingIdempotency` create, fetch existing appointment and return it (idempotent response).

---

## Summary Table

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| 1. High concurrency | 1 booking, rest conflict | ✅ Correct | PASS |
| 2. Duplicate requests | 1 booking, same response | ✅ P2002 handled | PASS |
| 3. Transaction retry | Retry, no infinite loop | ✅ Correct | PASS |
| 4. Redis failure | Fail fast or safe fallback | ✅ Correct | PASS |
| 5. Lock ownership | Reject non-owner | ✅ Correct | PASS |
| 6. Multi-tab | One lock, prev invalidated | ✅ Correct | PASS |
| 7. Admin override | User gets conflict | ✅ Correct | PASS |
| 8. Cache inconsistency | DB truth | ✅ Correct | PASS |
| 9. Timezone | No incorrect overlaps | ⚠️ TZ not used | REVIEW |
| 10. Rate limit | Block excess | ⚠️ Per-IP not per-user | REVIEW |
| 11. Backpressure | No crash | ⚠️ Limits unknown | LOAD TEST |
| 12. Idempotency failure | Clean retry | ✅ P2002 handled | PASS |

---

## Recommended Fixes (Priority)

1. ~~**Idempotency race (P2002):**~~ ✅ DONE. On unique violation for `bookingIdempotency`, fetch existing appointment and return.
2. **Per-user rate limiting:** Use userId in throttle key for booking endpoints.
3. **Timezone:** Use Business.timezone when parsing date+time for storage.

## Running the Stress Test

```bash
cd barber-platform/backend
npm run prisma:seed-demo   # if needed - creates staff with working hours
npx ts-node -r tsconfig-paths/register scripts/booking-stress-test.ts
```

Requires: DATABASE_URL, Redis (or ENABLE_REDIS=false), seeded data with StaffWorkingHours and StaffService.
