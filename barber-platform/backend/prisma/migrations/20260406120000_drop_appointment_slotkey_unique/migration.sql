-- Booking correctness: conflict detection is range-based (GiST EXCLUDE on appointments + holds).
-- Global UNIQUE on slotKey falsely rejects re-books after cancel and misaligns with multi-duration overlap logic.
DROP INDEX IF EXISTS "appointments_slotKey_key";

-- Redundant with EXCLUDE (staffId, tsrange(startTime, endTime) '[)') for active rows; same start + different duration is valid to reason about only via ranges.
DROP INDEX IF EXISTS "appointments_staffId_startTime_active_key";
