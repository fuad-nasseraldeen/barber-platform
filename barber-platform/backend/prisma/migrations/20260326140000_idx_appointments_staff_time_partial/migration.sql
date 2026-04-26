-- Speed GET /availability booking overlap scan: filter matches partial index predicate.
CREATE INDEX IF NOT EXISTS idx_appointments_staff_time
ON appointments ("staffId", "startTime", "endTime")
WHERE status NOT IN ('CANCELLED', 'NO_SHOW');
