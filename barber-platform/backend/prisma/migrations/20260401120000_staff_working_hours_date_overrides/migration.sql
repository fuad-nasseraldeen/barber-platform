-- CreateTable
CREATE TABLE "staff_working_hours_date_overrides" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_working_hours_date_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_working_hours_date_overrides_staffId_date_key" ON "staff_working_hours_date_overrides"("staffId", "date");

-- CreateIndex
CREATE INDEX "staff_working_hours_date_overrides_staffId_date_idx" ON "staff_working_hours_date_overrides"("staffId", "date");

-- AddForeignKey
ALTER TABLE "staff_working_hours_date_overrides" ADD CONSTRAINT "staff_working_hours_date_overrides_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
