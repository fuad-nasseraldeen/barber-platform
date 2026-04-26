-- Consumed holds + appointment ↔ hold + optional idempotency key (unique per business when set).
-- NOTE: `appointments` uses camelCase column names (businessId, …) per init schema — not snake_case.

ALTER TABLE "slot_holds" ADD COLUMN "consumed_at" TIMESTAMP(3);

ALTER TABLE "appointments" ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "appointments" ADD COLUMN "slotHoldId" TEXT;

CREATE UNIQUE INDEX "appointments_slot_hold_id_key" ON "appointments"("slotHoldId");

CREATE UNIQUE INDEX "appointments_businessId_idempotencyKey_key" ON "appointments"("businessId", "idempotencyKey");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_hold_id_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
