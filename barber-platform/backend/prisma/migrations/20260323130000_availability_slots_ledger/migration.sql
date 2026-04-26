-- CreateEnum
CREATE TYPE "AvailabilitySlotStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED');

-- CreateTable
CREATE TABLE "availability_slots" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "AvailabilitySlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "heldSessionId" TEXT,
    "heldUntil" TIMESTAMP(3),
    "appointmentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "availability_slots_businessId_staffId_serviceId_date_startTime_key" ON "availability_slots"("businessId", "staffId", "serviceId", "date", "startTime");

-- CreateIndex
CREATE INDEX "availability_slots_businessId_date_staffId_idx" ON "availability_slots"("businessId", "date", "staffId");

-- CreateIndex
CREATE INDEX "availability_slots_staffId_date_idx" ON "availability_slots"("staffId", "date");

-- CreateIndex
CREATE INDEX "availability_slots_status_idx" ON "availability_slots"("status");

-- CreateIndex
CREATE INDEX "availability_slots_appointmentId_idx" ON "availability_slots"("appointmentId");

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No double-booking for active appointments (same staff + same instant start)
CREATE UNIQUE INDEX "appointments_staffId_startTime_active_key" ON "appointments"("staffId", "startTime")
WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');
