-- Slot holds: short-lived reservations; no overlapping active holds per staff (GiST EXCLUDE).
-- IDs are TEXT to match existing schema (staff, users, businesses, etc.).
-- Overlaps use half-open ranges [start_time, end_time).

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "slot_holds" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "business_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "slot_holds_start_before_end" CHECK ("start_time" < "end_time"),
    CONSTRAINT "slot_holds_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "slot_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "slot_holds_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "slot_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "slot_holds_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_no_overlap_per_staff"
EXCLUDE USING gist (
    "staff_id" WITH =,
    tsrange("start_time", "end_time", '[)') WITH &&
);

CREATE INDEX "slot_holds_expires_at_idx" ON "slot_holds" ("expires_at");
CREATE INDEX "slot_holds_staff_time_idx" ON "slot_holds" ("staff_id", "start_time");
