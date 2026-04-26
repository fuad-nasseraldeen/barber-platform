-- Precomputed time slots: O(1) availability reads instead of O(n) UNION compute.
-- Each row = one bookable start time for a staff member on a business-local date.
-- Status transitions: free → held → booked, or free → booked (admin), held → free (expire/cancel).

CREATE TABLE "time_slots" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "business_id"     TEXT NOT NULL,
    "staff_id"        TEXT NOT NULL,
    "date"            DATE NOT NULL,
    "start_time"      TEXT NOT NULL,
    "end_min"         INT  NOT NULL,
    "duration_minutes" INT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'free',
    "hold_id"         TEXT,
    "appointment_id"  TEXT,
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "time_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "time_slots_status_check" CHECK ("status" IN ('free', 'held', 'booked')),
    CONSTRAINT "time_slots_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
    CONSTRAINT "time_slots_staff_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE,
    CONSTRAINT "time_slots_staff_date_time_uq" UNIQUE ("staff_id", "date", "start_time")
);

-- Primary query: GET /availability → SELECT WHERE status='free'
CREATE INDEX "idx_time_slots_staff_date_status" ON "time_slots" ("staff_id", "date", "status");

-- Range operations: multi-slot hold/book by end_min range
CREATE INDEX "idx_time_slots_staff_date_endmin" ON "time_slots" ("staff_id", "date", "end_min");

-- Hold expiry cleanup
CREATE INDEX "idx_time_slots_hold_id" ON "time_slots" ("hold_id") WHERE "hold_id" IS NOT NULL;

-- Booking cleanup
CREATE INDEX "idx_time_slots_appointment_id" ON "time_slots" ("appointment_id") WHERE "appointment_id" IS NOT NULL;
