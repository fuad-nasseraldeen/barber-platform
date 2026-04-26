-- CreateTable
CREATE TABLE "booking_idempotency" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_businessId_idempotencyKey_key" ON "booking_idempotency"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "booking_idempotency_businessId_idx" ON "booking_idempotency"("businessId");

-- AddForeignKey
ALTER TABLE "booking_idempotency" ADD CONSTRAINT "booking_idempotency_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_idempotency" ADD CONSTRAINT "booking_idempotency_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
