-- CreateEnum
CREATE TYPE "VacationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "requireEmployeeVacationApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "staff_time_off" ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "status" "VacationStatus" NOT NULL DEFAULT 'APPROVED';
