-- CreateTable
CREATE TABLE "staff_break_exceptions" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "branchId" TEXT,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_break_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_break_exceptions_staffId_idx" ON "staff_break_exceptions"("staffId");

-- CreateIndex
CREATE INDEX "staff_break_exceptions_staffId_date_idx" ON "staff_break_exceptions"("staffId", "date");

-- CreateIndex
CREATE INDEX "staff_break_exceptions_branchId_idx" ON "staff_break_exceptions"("branchId");

-- AddForeignKey
ALTER TABLE "staff_break_exceptions" ADD CONSTRAINT "staff_break_exceptions_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_break_exceptions" ADD CONSTRAINT "staff_break_exceptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
