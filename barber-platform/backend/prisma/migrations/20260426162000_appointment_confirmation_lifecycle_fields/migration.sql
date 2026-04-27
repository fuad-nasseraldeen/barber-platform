-- Add confirmation lifecycle enum and appointment lifecycle fields
CREATE TYPE "AppointmentConfirmationStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'EXPIRED',
  'NOT_REQUIRED'
);

ALTER TABLE "appointments"
ADD COLUMN "confirmationStatus" "AppointmentConfirmationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "confirmationChannel" TEXT,
ADD COLUMN "checkedInAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "noShowAt" TIMESTAMP(3),
ADD COLUMN "completedByStaffId" TEXT;

-- Optional status extension for lifecycle readability
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CHECKED_IN';

CREATE INDEX "appointments_businessId_confirmationStatus_idx"
  ON "appointments"("businessId", "confirmationStatus");
