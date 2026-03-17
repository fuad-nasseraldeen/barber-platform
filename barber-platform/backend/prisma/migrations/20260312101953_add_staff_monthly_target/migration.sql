-- AlterTable (IF NOT EXISTS for idempotency - column may already exist)
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "monthlyTargetRevenue" DECIMAL(12,2);
