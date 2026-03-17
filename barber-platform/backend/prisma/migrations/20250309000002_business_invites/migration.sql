-- Business invites for staff invitation flow

CREATE TABLE "business_invites" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_invites_token_key" ON "business_invites"("token");
CREATE UNIQUE INDEX "business_invites_businessId_email_key" ON "business_invites"("businessId", "email");
CREATE INDEX "business_invites_businessId_idx" ON "business_invites"("businessId");
CREATE INDEX "business_invites_token_idx" ON "business_invites"("token");

ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
