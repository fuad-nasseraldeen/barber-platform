# Booking Core Stable v1

## Status
This document freezes the current booking and availability engine as an internal stable release:
`booking-core-stable-v1`.

Scope of this freeze:
- Preserve existing business behavior.
- Preserve existing booking lifecycle behavior.
- Preserve existing correctness and performance characteristics.

## Architecture Overview
Core components:
- `BookingService`: booking lifecycle orchestration and availability API path integration.
- `ComputedAvailabilityService`: computed availability path and validation helpers.
- `TimeSlotService`: `time_slots` projection mutation and read helpers.
- `AvailabilityHotCacheService`: Redis hot cache for `time_slots` day blobs.
- `SlotHoldService`: DB-authoritative hold acquisition and hold lifecycle.
- `TimeSlotProjectionLifecycleService`: projection regeneration and mutation-triggered refresh.
- `BookingRescheduleProjectionWorkerService`: outbox-driven reschedule projection reconciliation.

Primary data stores:
- PostgreSQL: source of truth for appointments, holds, and `time_slots` projection.
- Redis: availability hot cache and related ephemeral layers for low-latency reads.

## Booking Flow
Lifecycle:
1. `availability`
2. `hold`
3. `book`
4. `cancel`
5. `reschedule`

Expected behavior:
- Availability reflects free slots for selected staff/service/date.
- Hold reserves a candidate slot window for short TTL.
- Book atomically confirms from hold and blocks slot range.
- Cancel frees previously booked slot range.
- Reschedule moves booking from old slot range to new slot range and keeps availability synchronized.

## DB Guarantees
Key guarantees currently relied on:
- EXCLUDE overlap constraints prevent overlapping reservations for the same staff in protected ranges.
- Unique/idempotency protections on booking and hold identity fields prevent duplicate lifecycle consumption.
- Slot conflict handling is DB-authoritative; API conflict responses surface DB truth.

## Availability Engine Path
Current read path:
- `time_slots` projection is the primary availability source when `USE_TIME_SLOTS=1`.
- Redis hot cache (`AVAILABILITY_REDIS_CACHE=1`) stores per staff-day blobs for low-latency GET availability.
- Read-repair can be enabled to reconcile near-term cache/projection drift against DB occupancy.

Current write-path sync:
- Hold, book, cancel, and reschedule update occupancy-related state and invalidate affected cache keys.
- Dirty-day markers and outbox reconciliation support consistency around asynchronous edges.

## Projection Regeneration Dependency
The booking engine depends on projection readiness:
- `time_slots` rows must exist for active staff across the booking window.
- Projection lifecycle regeneration is required after schedule/holiday/availability-affecting changes.
- Operational scripts should be used to regenerate and verify projection health.

## Operational Requirements
- Projection must exist for booking window dates before production traffic.
- Redis is required for target performance and stable low-latency availability reads.
- Scheduler/worker components must be running for ongoing projection and outbox maintenance.

## Known Caveats / Future Improvements
- Outbox-driven projection reconciliation still introduces eventual-consistency windows under some failures.
- Projection health should be continuously monitored to detect missing staff-day rows early.
- Multi-tenant timezone diagnostics can be expanded for easier operations visibility.
- Future versions may consolidate projection and read-repair observability into a single health surface.
