/**
 * Central flag for Redis usage. When false, no Redis connections are made.
 * Use ENABLE_REDIS=true in production; ENABLE_REDIS=false for development without Redis.
 *
 * Redis is REQUIRED in production for:
 * - Distributed slot locking (prevents double booking across instances)
 * - Availability cache
 * - Background queues
 *
 * Tradeoffs:
 * - Option A (this impl): Fail fast if Redis required but unavailable. Prevents silent double-booking.
 * - Option B: DB-level locking fallback. More complex, row-level locks, potential deadlocks.
 */
export const enableRedis = process.env.ENABLE_REDIS === 'true';

/** When true, app fails to start if Redis is required (production) but unavailable */
export const requireRedisInProduction =
  process.env.REQUIRE_REDIS_IN_PRODUCTION !== 'false';
