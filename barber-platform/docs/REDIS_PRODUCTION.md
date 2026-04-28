# Redis in Production — Scheduling System

## Overview

The scheduling system uses Redis for:

1. **Slot locking** — Prevents double booking during checkout (lock → confirm → release)
2. **Availability cache** — Speeds up slot computation
3. **Background queues** — Availability regeneration, notifications, automation

## Production Requirement

**Redis is required in production** for correct slot locking and multi-instance deployment.

| Mode | ENABLE_REDIS | Behavior |
|------|--------------|----------|
| **Production** | `true` | Redis required. Slot locks are distributed. |
| **Development** | `false` | In-memory stub. Single-instance only. No distributed locking. |

### Why Redis is Required in Production

- **Slot locking**: When a user selects a slot and proceeds to checkout, the slot is locked for 10 minutes. Without Redis (or with an in-memory stub), locks are not shared across multiple API instances. Two users could book the same slot simultaneously.
- **Multi-instance**: If you run multiple backend instances behind a load balancer, only Redis provides distributed locking.

### Tradeoffs

| Approach | Pros | Cons |
|----------|------|------|
| **Enforce Redis (current)** | Correct behavior, no double booking | Requires Redis in production |
| **DB-level locking fallback** | Works without Redis | More complex, row-level locks, potential deadlocks, slower |

**Recommendation**: Use Redis in production. It is the standard approach for distributed locking.

## Configuration

```env
# Production
ENABLE_REDIS=true
REDIS_URL=redis://...   # or REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

# Development (single instance, no Redis)
ENABLE_REDIS=false
```

## When Redis is Unavailable

- **ENABLE_REDIS=false**: Uses in-memory stub. Safe for single-instance development.
- **ENABLE_REDIS=true** and Redis connection fails: Slot lock operations may throw. Ensure Redis is running and reachable before starting the app.

## Cache Invalidation

When these events occur, availability cache is invalidated:

- Booking create / update / delete
- Staff working hours change
- Breaks change
- Time off / holidays change

See `AvailabilityWorkerService.invalidateForStaffDate` and `invalidateAndQueueForStaff`.
