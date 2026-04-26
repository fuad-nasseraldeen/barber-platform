-- Supports availability query: staff + time range overlap + active (non-expired) holds
CREATE INDEX "slot_holds_staff_id_start_time_end_time_expires_at_idx" ON "slot_holds" ("staff_id", "start_time", "end_time", "expires_at");
