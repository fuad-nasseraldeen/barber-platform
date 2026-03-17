-- AlterTable
ALTER TABLE "staff_services" ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "price" DECIMAL(10,2) NOT NULL DEFAULT 0;
