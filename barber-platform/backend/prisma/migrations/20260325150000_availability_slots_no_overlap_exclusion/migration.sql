-- =============================================================================
-- Non-overlapping availability intervals per staff + calendar day
-- =============================================================================
-- Problem: per-service rows used raw duration end times (e.g. 07:00–07:35 and
-- 07:30–08:05), so two AVAILABLE rows could claim the same real-world time and
-- break anchor locking under concurrency.
--
-- App fix (same deploy): ledger generation uses 30-min grid spans and greedy
-- non-overlap packing across services (see AvailabilitySlotLedgerService).
--
-- Safe rollout (single release recommended):
--   1. Deploy backend with updated generation + run this migration.
--   2. Regenerate precompute: POST /api/v1/availability/regenerate (per date or
--      all staff) or let the availability worker / scheduler refill.
--
-- Requires btree_gist (Supabase: enable in Database → Extensions if migrate fails).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Legacy rows may violate exclusion; wipe precomputed ledger (appointments table untouched).
DELETE FROM "availability_slots";

ALTER TABLE "availability_slots" DROP CONSTRAINT IF EXISTS "availability_slots_staff_date_time_excl";

ALTER TABLE "availability_slots"
  ADD CONSTRAINT "availability_slots_staff_date_time_excl"
  EXCLUDE USING gist (
    "staffId" WITH =,
    "date" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );
