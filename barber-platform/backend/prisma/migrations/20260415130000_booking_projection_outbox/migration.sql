-- Phase 1: async projection outbox for reschedule path.
-- Source of truth remains appointments; this table is only for post-commit projection work.

CREATE TABLE "booking_projection_outbox" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "business_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_projection_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_projection_outbox_status_check"
      CHECK ("status" IN ('PENDING', 'PROCESSING', 'DONE')),
    CONSTRAINT "booking_projection_outbox_event_type_check"
      CHECK ("event_type" IN ('RESCHEDULE_APPLIED'))
);

CREATE INDEX "booking_projection_outbox_status_available_created_idx"
  ON "booking_projection_outbox"("status", "available_at", "created_at");

CREATE INDEX "booking_projection_outbox_event_status_available_idx"
  ON "booking_projection_outbox"("event_type", "status", "available_at");

CREATE INDEX "booking_projection_outbox_business_created_idx"
  ON "booking_projection_outbox"("business_id", "created_at");
