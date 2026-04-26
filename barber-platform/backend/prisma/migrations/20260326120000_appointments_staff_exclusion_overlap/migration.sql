-- Prevent overlapping active appointments for the same staff (concurrency safety without slot ledger).
-- Prisma DateTime -> PostgreSQL "timestamp without time zone": use tsrange (not tstzrange).
-- tstzrange on timestamp columns forces timestamp->timestamptz casts that are STABLE (session TZ),
-- which fails: "functions in index expression must be marked IMMUTABLE" (42P17).
-- Requires btree_gist for (staffId =) + (tsrange &&).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_staff_active_no_overlap"
EXCLUDE USING GIST (
  "staffId" WITH =,
  tsrange("startTime", "endTime", '[)') WITH &&
)
WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));
