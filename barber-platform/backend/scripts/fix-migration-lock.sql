-- =============================================================================
-- Fix Prisma migration lock - Run this in Supabase SQL Editor
-- =============================================================================
-- 1. Terminate connections holding the advisory lock (releases the lock)
-- 2. Remove the failed migration record (so Prisma will retry it)
-- =============================================================================

-- Step 1: Kill connections holding Prisma's advisory lock (72707369)
SELECT pg_terminate_backend(PSA.pid) AS terminated
FROM pg_locks AS PL
INNER JOIN pg_stat_activity AS PSA ON PSA.pid = PL.pid
WHERE PL.locktype = 'advisory'
  AND PL.objid = 72707369
  AND PSA.pid != pg_backend_pid();

-- Step 2: Remove the failed migration record (Prisma will retry on next deploy)
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260312101953_add_staff_monthly_target';
