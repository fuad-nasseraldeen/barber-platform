# Booking Test Suite

Comprehensive correctness, concurrency, and consistency tests for the booking system.

## Prerequisites

- Node 18+ (native fetch)
- k6 installed (`brew install k6` / `choco install k6`)
- `backend/.env` with `BUSINESS_ID`, `AUTH_TOKEN`, `DATABASE_URL`, `BASE_URL`
- API server running
- Seeded data (staff, services, customers)

## Quick Start

```bash
# DB invariant check (fastest, no API needed)
npm run test:booking:invariants

# After any k6 run — DB overlap + hold checks
npm run test:booking:post-k6

# Property-based: 100 random scenarios with invariant checks
npm run test:booking:property

# Long-run: 60s of random operations then full sweep
npm run test:booking:longrun

# Time-edge: boundary slots, timezone round-trip
npm run test:booking:time

# k6 cache consistency: hold then immediately re-check availability
npm run k6:cache-consistency

# k6 chaos: 20 VUs, mixed race + partition + read-only
npm run k6:chaos
```

## Test Categories

### Invariants (`invariants/`)
Core correctness predicates checked by every other test:

| Code | What it checks |
|------|---------------|
| `APPOINTMENT_OVERLAP` | No two active appointments for same staff overlap |
| `SLOT_HOLD_OVERLAP` | No two active holds for same staff overlap |
| `APPOINTMENT_VS_HOLD_OVERLAP` | Active appointment doesn't overlap foreign hold |
| `AVAILABILITY_OFFERS_OCCUPIED` | GET /availability doesn't list occupied slots |

### Property-based (`property/`)
Random sequences of hold/book/cancel/reschedule. Configurable iterations.

### Long-run (`longrun/`)
Sustained random operations for 1-10 minutes. Periodic invariant sweeps.

### Time-edge (`time/`)
Boundary conditions: first/last slot of day, timezone round-trips, adjacent-day booking.

### Cache consistency (k6)
Hold a slot, immediately re-read availability. Threshold: 0 stale reads.

### Chaos (k6)
20-50 VUs with mixed operations. Race cluster fights for one slot while partition VUs take different slots.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUSINESS_ID` | required | Target business UUID |
| `AUTH_TOKEN` | required | JWT access token |
| `DATABASE_URL` | required | Postgres connection string |
| `BASE_URL` | `http://localhost:3000` | API base URL |
| `PROPERTY_ITERATIONS` | `100` | Property test iteration count |
| `LONGRUN_SECONDS` | `60` | Long-run test duration |
| `LONGRUN_OPS_PER_SEC` | `2` | Operations per second |
| `K6_CACHE_VUS` | `10` | Cache consistency VU count |
| `K6_CHAOS_VUS` | `20` | Chaos test VU count |
| `K6_CHAOS_RACE_CLUSTER` | `8` | VUs fighting for same slot |

## Success Criteria

All tests passing means:
- 0 invariant violations across all DB checks
- Race tests produce exactly 1 hold winner
- No stale availability reads after writes
- No overlapping appointments or holds
- Consistent behavior across 1000+ random runs
