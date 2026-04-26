-- Distinguish recurring/lunch-style breaks (orange UI) from admin "block time" (gray UI).
CREATE TYPE "StaffBreakExceptionKind" AS ENUM ('BREAK', 'TIME_BLOCK');

ALTER TABLE "staff_break_exceptions"
ADD COLUMN "kind" "StaffBreakExceptionKind" NOT NULL DEFAULT 'BREAK';
