-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "healthDeclarationCompleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "staff_services" ADD COLUMN     "allowBooking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "popupMessage" TEXT,
ADD COLUMN     "sendHealthDeclaration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- (Removed broken RenameIndex: availability_slots is created in migration 20260323130000
-- with the final unique index name already; renaming here fails on shadow DB — P1014.)
