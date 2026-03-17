-- AlterTable
ALTER TABLE "waitlist" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "waitlist_staffId_idx" ON "waitlist"("staffId");

-- CreateIndex
CREATE INDEX "waitlist_expiresAt_idx" ON "waitlist"("expiresAt");

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
