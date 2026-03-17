-- CreateTable
CREATE TABLE "daily_business_stats" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalAppointments" INTEGER NOT NULL DEFAULT 0,
    "completedAppointments" INTEGER NOT NULL DEFAULT 0,
    "cancelledAppointments" INTEGER NOT NULL DEFAULT 0,
    "noShowAppointments" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "waitlistCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_business_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_staff_stats" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalBookings" INTEGER NOT NULL DEFAULT 0,
    "completedBookings" INTEGER NOT NULL DEFAULT 0,
    "cancelledBookings" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_staff_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_service_stats" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_service_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_business_stats_businessId_idx" ON "daily_business_stats"("businessId");

-- CreateIndex
CREATE INDEX "daily_business_stats_businessId_date_idx" ON "daily_business_stats"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_business_stats_businessId_date_key" ON "daily_business_stats"("businessId", "date");

-- CreateIndex
CREATE INDEX "daily_staff_stats_businessId_idx" ON "daily_staff_stats"("businessId");

-- CreateIndex
CREATE INDEX "daily_staff_stats_businessId_date_idx" ON "daily_staff_stats"("businessId", "date");

-- CreateIndex
CREATE INDEX "daily_staff_stats_staffId_date_idx" ON "daily_staff_stats"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_staff_stats_businessId_staffId_date_key" ON "daily_staff_stats"("businessId", "staffId", "date");

-- CreateIndex
CREATE INDEX "daily_service_stats_businessId_idx" ON "daily_service_stats"("businessId");

-- CreateIndex
CREATE INDEX "daily_service_stats_businessId_date_idx" ON "daily_service_stats"("businessId", "date");

-- CreateIndex
CREATE INDEX "daily_service_stats_serviceId_date_idx" ON "daily_service_stats"("serviceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_service_stats_businessId_serviceId_date_key" ON "daily_service_stats"("businessId", "serviceId", "date");

-- AddForeignKey
ALTER TABLE "daily_business_stats" ADD CONSTRAINT "daily_business_stats_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_staff_stats" ADD CONSTRAINT "daily_staff_stats_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_staff_stats" ADD CONSTRAINT "daily_staff_stats_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_service_stats" ADD CONSTRAINT "daily_service_stats_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_service_stats" ADD CONSTRAINT "daily_service_stats_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
