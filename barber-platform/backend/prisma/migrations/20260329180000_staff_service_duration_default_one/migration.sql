-- New staff–service links default to 1 minute (must be set explicitly in app/admin; aligns with no hardcoded 30).
ALTER TABLE "staff_services" ALTER COLUMN "durationMinutes" SET DEFAULT 1;
