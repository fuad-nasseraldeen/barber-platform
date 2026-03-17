-- CreateEnum
CREATE TYPE "CustomerVisitStatus" AS ENUM ('COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_visits" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "status" "CustomerVisitStatus" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_visits_appointmentId_key" ON "customer_visits"("appointmentId");

-- CreateIndex
CREATE INDEX "customer_visits_businessId_idx" ON "customer_visits"("businessId");

-- CreateIndex
CREATE INDEX "customer_visits_customerId_idx" ON "customer_visits"("customerId");

-- CreateIndex
CREATE INDEX "customer_visits_staffId_idx" ON "customer_visits"("staffId");

-- CreateIndex
CREATE INDEX "customer_visits_branchId_idx" ON "customer_visits"("branchId");

-- CreateIndex
CREATE INDEX "customer_visits_visitDate_idx" ON "customer_visits"("visitDate");

-- CreateIndex
CREATE INDEX "customer_visits_businessId_visitDate_idx" ON "customer_visits"("businessId", "visitDate");

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
