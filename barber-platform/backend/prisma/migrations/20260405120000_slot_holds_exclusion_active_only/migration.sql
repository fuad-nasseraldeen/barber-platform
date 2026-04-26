-- Only *unconsumed* holds participate in overlap exclusion.
-- Rows with consumed_at set are kept for FK from appointments but must not block new reservations
-- in the same wall window (availability already ignores them via consumed_at IS NULL).

ALTER TABLE "slot_holds" DROP CONSTRAINT IF EXISTS "slot_holds_no_overlap_per_staff";

ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_no_overlap_per_staff"
EXCLUDE USING gist (
  "staff_id" WITH =,
  tsrange("start_time", "end_time", '[)') WITH &&
)
WHERE ("consumed_at" IS NULL);
