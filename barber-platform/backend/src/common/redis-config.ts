/**
 * Central flag for Redis usage. When false, no Redis connections are made.
 * Use ENABLE_REDIS=true in production; ENABLE_REDIS=false for development without Redis.
 */
export const enableRedis = process.env.ENABLE_REDIS === 'true';
