# Scheduling System — Production Hardening

## Timezone Safety

**Storage:** All `startTime` and `endTime` in the DB are stored in UTC (PostgreSQL `timestamptz`).

**API contract:** The API accepts `date` (YYYY-MM-DD) and `startTime` (HH:mm). These are interpreted in the **business timezone** (Business.timezone, default "UTC"). The backend converts to UTC for storage.

**Frontend:** Convert UTC timestamps from the API to the business local time for display. Use the business timezone from the API.

**Edge cases:**
- Daylight saving: Use IANA timezone (e.g. "America/New_York") for correct DST handling
- Cross-day bookings: Validation uses `startTime < endTime` overlap logic; dates are derived from UTC timestamps

## Transaction Safety

- **createAppointment**, **confirmBooking**, **updateAppointment** run inside `$transaction` with `Serializable` isolation
- Validation (including overlap check) runs **inside** the transaction using the transaction client
- Redis lock is released **after** transaction commits (confirm flow only)
- Serialization failures (P2034) return clear conflict errors

## Admin Override Safety

- Admin create/update use `skipLockCheck: true` — can override user-held locks
- **confirmBooking** always re-validates inside the transaction — if admin took the slot, user gets `OVERLAPS_BOOKING`
- No double booking: overlap check runs before insert

## slotKey

- `slotKey` is **index only**, never used for validation
- Overlap uses: `startTime < newEndTime AND endTime > newStartTime`

## Redis

- Production: `ENABLE_REDIS=true` required. Fail fast if unavailable (`REQUIRE_REDIS_IN_PRODUCTION`).
- See `docs/REDIS_PRODUCTION.md`

## Logging

- Request context: `requestId`, `tenantId` (businessId), `userId`
- Validation failures logged with context and error details
- Transaction conflicts logged for debugging

## Idempotency

- `createAppointment` and `confirmBooking` accept optional `idempotencyKey`
- Stored in `BookingIdempotency` with `UNIQUE(businessId, idempotencyKey)`
- Duplicate request with same key returns existing booking (no new one created)
- Survives server restarts (DB-backed)

## Transaction Retry

- Serializable transactions retry on P2034 (serialization failure)
- Exponential backoff, max 5 attempts
- `withTransactionRetry()` wraps create/confirm transactions

## Lock Ownership

- Lock value format: `sessionId:userId` for ownership verification
- On confirm: verify lock matches request's sessionId and userId
- Release only by owner (sessionId passed to releaseLockForDuration)

## Multi-Tab Protection

- One active lock per `userId + staffId + date + startTime`
- When user acquires new lock for same slot, previous lock is released
- `user_lock:{tenantId}:{userId}:{staffId}:{date}:{startTime}` -> sessionId

## Metrics

- `GET /appointments/metrics?businessId=...` — per-tenant counters
- booking_attempt_count, booking_success_count, booking_conflict_count
- transaction_retry_count, lock_acquire_count, lock_acquire_failure_count

## Rate Limiting

- Lock: 10/min per user
- Confirm: 10/min per user
- Create: 30/min per user
