-- Auth: Phone OTP + Google OAuth support

ALTER TABLE "users" 
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "authProvider" SET DEFAULT 'phone';

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");
