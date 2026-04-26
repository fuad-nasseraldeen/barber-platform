-- Speed anchor UPDATE ... FOR UPDATE SKIP LOCKED (holdAvailableAnchorSkipLocked)
CREATE INDEX IF NOT EXISTS "availability_slots_staffId_date_startTime_status_idx"
ON "availability_slots" ("staffId", "date", "startTime", "status");
