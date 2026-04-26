/**
 * Load .env / .env.local before AppModule (and any file that reads process.env at import time,
 * e.g. booking.controller throttling). ConfigModule.forRoot runs too late for those constants.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();
for (const name of ['.env', '.env.local'] as const) {
  const p = resolve(cwd, name);
  if (existsSync(p)) {
    /* Always override: stray empty DATABASE_URL in OS env must not win over .env (breaks Prisma). */
    config({ path: p, override: true });
  }
}
