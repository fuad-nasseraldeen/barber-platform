-- Performance optimizations: availability cache schema + indexes

-- 1. Recreate staff_availability_cache with new schema (slots JSON, generatedAt)
-- Drop old indexes
DROP INDEX IF EXISTS "staff_availability_cache_staffId_slotStart_slotEnd_idx";

-- Truncate old slot-per-row data (cannot migrate to new format automatically)
TRUNCATE TABLE "staff_availability_cache";

-- Alter table
ALTER TABLE "staff_availability_cache" 
  DROP COLUMN "slotStart",
  DROP COLUMN "slotEnd",
  DROP COLUMN "isAvailable",
  DROP COLUMN "cachedAt";

ALTER TABLE "staff_availability_cache" 
  ADD COLUMN "slots" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "staff_availability_cache_staffId_date_key" ON "staff_availability_cache"("staffId", "date");

-- 2. Add customers(phone) index for phone lookup
CREATE INDEX IF NOT EXISTS "customers_phone_idx" ON "customers"("phone");
