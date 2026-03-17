-- AlterTable: Add branchId to services
ALTER TABLE "services" ADD COLUMN "branchId" TEXT;

-- Backfill: Assign existing services to first branch of each business
UPDATE "services" s
SET "branchId" = (
  SELECT b.id FROM "branches" b
  WHERE b."businessId" = s."businessId"
  ORDER BY b."createdAt" ASC
  LIMIT 1
)
WHERE s."branchId" IS NULL;

-- DropIndex
DROP INDEX "services_businessId_slug_key";

-- CreateIndex
CREATE INDEX "services_branchId_idx" ON "services"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "services_businessId_branchId_slug_key" ON "services"("businessId", "branchId", "slug");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
