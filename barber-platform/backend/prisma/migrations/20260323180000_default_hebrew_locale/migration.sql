-- New rows default to Hebrew; existing data unchanged.
ALTER TABLE "businesses" ALTER COLUMN "locale" SET DEFAULT 'he';
ALTER TABLE "user_settings" ALTER COLUMN "locale" SET DEFAULT 'he';
