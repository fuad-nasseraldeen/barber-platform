-- AlterTable
ALTER TABLE "services" ADD COLUMN "blockAllStaff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "service_staff_blocks" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_staff_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_staff_blocks_serviceId_staffId_key" ON "service_staff_blocks"("serviceId", "staffId");

-- CreateIndex
CREATE INDEX "service_staff_blocks_serviceId_idx" ON "service_staff_blocks"("serviceId");

-- CreateIndex
CREATE INDEX "service_staff_blocks_staffId_idx" ON "service_staff_blocks"("staffId");

-- AddForeignKey
ALTER TABLE "service_staff_blocks" ADD CONSTRAINT "service_staff_blocks_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_staff_blocks" ADD CONSTRAINT "service_staff_blocks_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
